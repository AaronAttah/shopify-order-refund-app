import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getVendorForStaff } from "../config/vendorStaffMapping";
import {
  Page,
  Layout,
  LegacyCard,
  IndexTable,
  Text,
  Badge,
  Pagination,
  EmptyState,
} from "@shopify/polaris";

interface Order {
  id: string;
  name: string;
  financialStatus: string;
  itemCount: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session  } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  // Log all session information for debugging
  console.log("=== SESSION DEBUG INFO ===");
  console.log("Full Session Object:", JSON.stringify(session, null, 2));
  console.log("Session Shop:", session.shop);
  console.log("Session ID:", session.id);
  console.log("Session Online Access Info:", session.onlineAccessInfo);
  
  // Try to get user email from different possible locations
  const userEmail = session.onlineAccessInfo?.associated_user?.email || null;
  console.log("User Email:", userEmail);
  console.log("Associated User:", session.onlineAccessInfo?.associated_user);
  console.log("========================");

  // Determine pagination direction
  const paginationArgs = before 
    ? { last: 10, before } 
    : { first: 10, after };

  const response = await admin.graphql(
    `#graphql
    query GetOrders($first: Int, $after: String, $last: Int, $before: String) {
      orders(first: $first, after: $after, last: $last, before: $before, sortKey: CREATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        edges {
          node {
            id
            name
            displayFinancialStatus
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  variant {
                    id
                    product {
                      id
                      vendor
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: paginationArgs,
    }
  );

  const responseJson = (await response.json()) as any;
  
  if (responseJson.errors) {
    console.error("GraphQL Errors:", responseJson.errors);
    throw new Error("Failed to fetch orders. Check terminal for details.");
  }

  // Get vendor assignment for current user
  const assignedVendor = userEmail ? getVendorForStaff(userEmail) : null;
  console.log("Assigned Vendor:", assignedVendor);

  // Process orders and filter by vendor if applicable
  const allOrders = responseJson.data.orders.edges;
  
  let filteredOrders: Order[];
  
  if (assignedVendor) {
    // Vendor staff: only show orders that contain their vendor's products
    filteredOrders = allOrders
      .map((edge: any) => {
        // Filter line items to only include this vendor's products
        const vendorLineItems = edge.node.lineItems.edges.filter((lineItemEdge: any) => {
          const vendor = lineItemEdge.node.variant?.product?.vendor;
          return vendor === assignedVendor;
        });

        // Only include the order if it has line items from this vendor
        if (vendorLineItems.length > 0) {
          return {
            id: edge.node.id,
            name: edge.node.name,
            financialStatus: edge.node.displayFinancialStatus,
            itemCount: vendorLineItems.length, // Count only vendor's items
          };
        }
        return null;
      })
      .filter((order: Order | null) => order !== null) as Order[];
    
    console.log(`Filtered to ${filteredOrders.length} orders for vendor: ${assignedVendor}`);
  } else {
    // Admin/Owner: show all orders
    filteredOrders = allOrders.map((edge: any) => ({
      id: edge.node.id,
      name: edge.node.name,
      financialStatus: edge.node.displayFinancialStatus,
      itemCount: edge.node.lineItems.edges.length,
    }));
    
    console.log(`Showing all ${filteredOrders.length} orders (Admin/Owner view)`);
  }

  return {
    orders: filteredOrders,
    pageInfo: responseJson.data.orders.pageInfo,
  };
};

export default function Index() {
  const { orders, pageInfo } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handlePagination = (direction: "next" | "prev") => {
    const params = new URLSearchParams();
    if (direction === "next" && pageInfo.endCursor) {
      params.set("after", pageInfo.endCursor);
    } else if (direction === "prev" && pageInfo.startCursor) {
      params.set("before", pageInfo.startCursor);
    }
    navigate(`?${params.toString()}`);
  };

  const resourceName = {
    singular: "order",
    plural: "orders",
  };

  const rowMarkup = orders.map(
    ({ id, name, financialStatus, itemCount }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {name}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={financialStatus === "PAID" ? "success" : "info"}>
            {financialStatus}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div style={{ textAlign: "right" }}>
            <Text as="span" numeric>
              {itemCount}
            </Text>
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Page title="Orders">
      <Layout>
        <Layout.Section>
          <LegacyCard>
            {orders.length === 0 ? (
              <EmptyState
                heading="No orders found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Make sure you have orders in your Shopify store.</p>
              </EmptyState>
            ) : (
              <>
                <IndexTable
                  resourceName={resourceName}
                  itemCount={orders.length}
                  headings={[
                    { title: "Order" },
                    { title: "Financial Status" },
                    { title: "Items", alignment: "end" },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    padding: "16px",
                    borderTop: "1px solid #dfe3e8",
                  }}
                >
                  <Pagination
                    hasPrevious={pageInfo.hasPreviousPage}
                    onPrevious={() => handlePagination("prev")}
                    hasNext={pageInfo.hasNextPage}
                    onNext={() => handlePagination("next")}
                  />
                </div>
              </>
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
