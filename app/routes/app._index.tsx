import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getVendorForStaff, getAllVendors } from "../config/vendorStaffMapping";
import {
  Page,
  Layout,
  LegacyCard,
  IndexTable,
  Text,
  Badge,
  Pagination,
  EmptyState,
  Select,
  Card,
  BlockStack,
} from "@shopify/polaris";

interface Order {
  id: string;
  name: string;
  financialStatus: string;
  itemCount: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const selectedVendor = url.searchParams.get("vendor");

  // Determine pagination direction
  const paginationArgs: any = before
    ? { last: 10, before }
    : { first: 10, after };

  // 1. Identify User & Effective Vendor
  const userEmail = session.onlineAccessInfo?.associated_user?.email || null;
  const assignedVendor = userEmail ? getVendorForStaff(userEmail) : null;
  
  // If user is assigned to a vendor, FORCE that vendor.
  // If user is Admin (assignedVendor is null), allow them to select a vendor via query param.
  const effectiveVendor = assignedVendor || selectedVendor;

  // 2. Prepare GraphQL Query Variables
  if (effectiveVendor) {
    paginationArgs.query = `vendor:"${effectiveVendor}"`;
  }

  const response = await admin.graphql(
    `#graphql
    query GetOrders($first: Int, $after: String, $last: Int, $before: String, $query: String) {
      orders(first: $first, after: $after, last: $last, before: $before, sortKey: CREATED_AT, reverse: true, query: $query) {
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
    throw new Error("Failed to fetch orders.");
  }

  const allOrders = responseJson.data.orders.edges;

  // 3. Process & Filter Orders (Strict Isolation)
  // Even though we queried by vendor, we must filter LINE ITEMS to ensuring
  // we don't show items from other vendors that happen to be in the same order.
  
  let filteredOrders: Order[];

  if (effectiveVendor) {
     filteredOrders = allOrders
      .map((edge: any) => {
        const vendorLineItems = edge.node.lineItems.edges.filter((lineItemEdge: any) => {
          const vendor = lineItemEdge.node.variant?.product?.vendor;
          return vendor === effectiveVendor;
        });

        if (vendorLineItems.length > 0) {
          return {
            id: edge.node.id,
            name: edge.node.name,
            financialStatus: edge.node.displayFinancialStatus,
            itemCount: vendorLineItems.length,
          };
        }
        return null;
      })
      .filter((order: Order | null) => order !== null) as Order[];
  } else {
    // Admin View (No specific vendor selected): Show everything
    filteredOrders = allOrders.map((edge: any) => ({
      id: edge.node.id,
      name: edge.node.name,
      financialStatus: edge.node.displayFinancialStatus,
      itemCount: edge.node.lineItems.edges.length,
    }));
  }

  return {
    orders: filteredOrders,
    pageInfo: responseJson.data.orders.pageInfo,
    user: {
      email: userEmail,
      isVendor: !!assignedVendor,
      assignedVendor,
    },
    meta: {
      availableVendors: !assignedVendor ? getAllVendors() : [], // Only send list if Admin
      currentVendor: effectiveVendor,
    }
  };
};

export default function Index() {
  const { orders, pageInfo, user, meta } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handlePagination = (direction: "next" | "prev") => {
    const params = new URLSearchParams(window.location.search);
    if (direction === "next" && pageInfo.endCursor) {
      params.set("after", pageInfo.endCursor);
      params.delete("before");
    } else if (direction === "prev" && pageInfo.startCursor) {
      params.set("before", pageInfo.startCursor);
      params.delete("after");
    }
    navigate(`?${params.toString()}`);
  };

  const handleVendorChange = (newVendor: string) => {
    const params = new URLSearchParams(window.location.search);
    if (newVendor) {
      params.set("vendor", newVendor);
    } else {
      params.delete("vendor");
    }
    // Reset pagination when filter changes
    params.delete("after");
    params.delete("before");
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
        {/* Admin Vendor Filter */}
        {!user.isVendor && meta.availableVendors.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">
                  Filter by Vendor (Admin Only)
                </Text>
                <Select
                  label="Select Vendor"
                  labelHidden
                  options={[
                    { label: "All Vendors", value: "" },
                    ...meta.availableVendors.map((v) => ({ label: v, value: v })),
                  ]}
                  value={meta.currentVendor || ""}
                  onChange={handleVendorChange}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard>
            {orders.length === 0 ? (
              <EmptyState
                heading={meta.currentVendor ? `No orders for ${meta.currentVendor}` : "No orders found"}
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
