import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface Order {
  id: string;
  name: string;
  financialStatus: string;
  itemCount: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

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

  const orders: Order[] = responseJson.data.orders.edges.map((edge: any) => ({
    id: edge.node.id,
    name: edge.node.name,
    financialStatus: edge.node.displayFinancialStatus,
    itemCount: edge.node.lineItems.edges.length,
  }));

  return {
    orders,
    pageInfo: responseJson.data.orders.pageInfo,
  };
};

export default function Index() {
  const { orders, pageInfo } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const handlePagination = (direction: "next" | "prev") => {
    const params = new URLSearchParams();
    console.log("PageInfo:", pageInfo);
    if (direction === "next" && pageInfo.endCursor) {
      params.set("after", pageInfo.endCursor);
    } else if (direction === "prev" && pageInfo.startCursor) {
      params.set("before", pageInfo.startCursor);
    }
    navigate(`?${params.toString()}`);
  };

  console.log("Orders data:", orders);
  console.log("Orders length:", orders.length);

  return (
    <s-page heading="Orders">
      <s-section>
        {orders.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center" }}>
            <p>No orders found. Make sure you have orders in your Shopify store.</p>
          </div>
        ) : (
          <div>
            <table style={{ 
              width: "100%", 
              borderCollapse: "collapse",
              backgroundColor: "white",
              border: "1px solid #e1e3e5"
            }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e1e3e5" }}>
                  <th style={{ 
                    padding: "12px 16px", 
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: "14px"
                  }}>Order</th>
                  <th style={{ 
                    padding: "12px 16px", 
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: "14px"
                  }}>Financial Status</th>
                  <th style={{ 
                    padding: "12px 16px", 
                    textAlign: "right",
                    fontWeight: 600,
                    fontSize: "14px"
                  }}>Items</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                    <td style={{ 
                      padding: "12px 16px",
                      fontWeight: 600,
                      fontSize: "14px"
                    }}>
                      {order.name}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 500,
                        backgroundColor: order.financialStatus === "PAID" ? "#3be36bff" : "#e0f0ff",
                        color: order.financialStatus === "PAID" ? "#00801eff" : "#0066cc"
                      }}>
                        {order.financialStatus}
                      </span>
                    </td>
                    <td style={{ 
                      padding: "12px 16px", 
                      textAlign: "right",
                      fontSize: "14px"
                    }}>
                      {order.itemCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ 
              marginTop: "16px", 
              display: "flex", 
              justifyContent: "center", 
              gap: "8px" 
            }}>
              <button
                disabled={!pageInfo.hasPreviousPage}
                onClick={() => handlePagination("prev")}
                style={{
                  padding: "8px 16px",
                  backgroundColor: pageInfo.hasPreviousPage ? "#008060" : "#e1e3e5",
                  color: pageInfo.hasPreviousPage ? "white" : "#6d7175",
                  border: "none",
                  borderRadius: "4px",
                  cursor: pageInfo.hasPreviousPage ? "pointer" : "not-allowed",
                  fontWeight: 500,
                  fontSize: "14px"
                }}
              >
                Previous
              </button>
              <button
                disabled={!pageInfo.hasNextPage}
                onClick={() => handlePagination("next")}
                style={{
                  padding: "8px 16px",
                  backgroundColor: pageInfo.hasNextPage ? "#008060" : "#e1e3e5",
                  color: pageInfo.hasNextPage ? "white" : "#6d7175",
                  border: "none",
                  borderRadius: "4px",
                  cursor: pageInfo.hasNextPage ? "pointer" : "not-allowed",
                  fontWeight: 500,
                  fontSize: "14px"
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
