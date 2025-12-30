import { useState, useCallback, useMemo } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import {
  Page,
  Layout,
  LegacyCard,
  IndexTable,
  Text,
  Badge,
  Thumbnail,
  BlockStack,
  Card,
  Bleed,
  Divider,
  TextField,
  Button,
  InlineStack,
  Modal,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { getVendorForStaff } from "../config/vendorStaffMapping";
import type { LoaderFunctionArgs } from "react-router";

// ... (loader function remains exactly the same) ...

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedVendor = url.searchParams.get("vendor");
  
  const orderId = `gid://shopify/Order/${params.id}`;

  const response = await admin.graphql(
    `#graphql
    query GetOrder($id: ID!) {
      order(id: $id) {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              quantity
              sku
              originalTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              variant {
                id
                price
                title
                product {
                  id
                  vendor
                }
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        id: orderId,
      },
    }
  );

  const responseJson = (await response.json()) as any;

  if (responseJson.errors) {
    console.error("GraphQL Errors:", responseJson.errors);
    throw new Response("Order not found", { status: 404 });
  }

  const order = responseJson.data.order;

  const userEmail = session.onlineAccessInfo?.associated_user?.email || null;
  const assignedVendor = userEmail ? getVendorForStaff(userEmail) : null;
  
  const effectiveVendor = assignedVendor || selectedVendor;

  const allLineItems = order.lineItems.edges;
  let filteredLineItems = [];

  if (effectiveVendor) {
    filteredLineItems = allLineItems.filter((edge: any) => {
      const itemVendor = edge.node.variant?.product?.vendor;
      return itemVendor === effectiveVendor;
    });

    if (assignedVendor && filteredLineItems.length === 0) {
        throw new Response("You do not have permission to view this order.", { status: 403 });
    }

  } else {
    filteredLineItems = allLineItems;
  }

  const filteredTotal = filteredLineItems.reduce((acc: number, edge: any) => {
    return acc + parseFloat(edge.node.originalTotalSet.shopMoney.amount);
  }, 0);

  return {
    order: {
      ...order,
      lineItems: filteredLineItems, 
    },
    effectiveVendor,
    formattedTotal: new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currencyCode }).format(filteredTotal)
  };
};

export default function OrderDetails() {
  const { order, effectiveVendor, formattedTotal } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // State for Refund Draft
  const [refundState, setRefundState] = useState<Record<string, number>>({});
  const [modalOpen, setModalOpen] = useState(false);

  const handleQuantityChange = (id: string, value: string, max: number) => {
    const qty = parseInt(value, 10);
    if (isNaN(qty) || qty < 0) {
        setRefundState(prev => {
            const newState = { ...prev };
            delete newState[id];
            return newState;
        });
        return;
    }
    // Validation: cannot refund more than purchased
    const validatedQty = Math.min(qty, max);
    setRefundState(prev => ({ ...prev, [id]: validatedQty }));
  };

  const calculatedRefundTotal = useMemo(() => {
    let total = 0;
    order.lineItems.forEach(({ node }: any) => {
        const qty = refundState[node.id] || 0;
        const price = parseFloat(node.variant?.price || "0");
        total += qty * price;
    });
    return total;
  }, [order.lineItems, refundState]);

  const hasItemsToRefund = calculatedRefundTotal > 0;

  const resourceName = {
    singular: "item",
    plural: "items",
  };

  const rowMarkup = order.lineItems.map(
    ({ node }: any, index: number) => {
        const refundQty = refundState[node.id] || 0;
        const maxQty = node.quantity;
        
        return (
            <IndexTable.Row id={node.id} key={node.id} position={index}>
                <IndexTable.Cell>
                <Thumbnail
                    source={node.variant?.image?.url || ImageIcon}
                    alt={node.variant?.image?.altText || node.title}
                    size="small"
                />
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <BlockStack>
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                            {node.title}
                        </Text>
                        <Text variant="bodySm" as="span" tone="subdued">
                            {node.variant?.title !== "Default Title" ? node.variant?.title : ''}
                        </Text>
                        <Text variant="bodySm" as="span" tone="subdued">
                            SKU: {node.sku || 'N/A'}
                        </Text>
                    </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                {node.variant?.price} {order.currencyCode}
                </IndexTable.Cell>
                <IndexTable.Cell>
                    {node.quantity}
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <div style={{ maxWidth: "100px" }}>
                        <TextField
                            label="Refund Qty"
                            labelHidden
                            type="number"
                            value={refundQty.toString()}
                            onChange={(val) => handleQuantityChange(node.id, val, maxQty)}
                            min={0}
                            max={maxQty}
                            autoComplete="off"
                        />
                    </div>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <div style={{ textAlign: "right" }}>
                        {(parseFloat(node.variant?.price || "0") * refundQty).toFixed(2)} {order.currencyCode}
                    </div>
                </IndexTable.Cell>
            </IndexTable.Row>
        );
    }
  );

  return (
    <Page
      backAction={{ content: "Orders", url: effectiveVendor ? `/app?vendor=${effectiveVendor}` : "/app" }}
      title={order.name}
      subtitle={`Placed on ${new Date(order.createdAt).toLocaleDateString()}`}
      titleMetadata={<Badge tone={order.displayFinancialStatus === 'PAID' ? 'success' : 'info'}>{order.displayFinancialStatus}</Badge>}
      compactTitle
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingSm">
                        Line Items {effectiveVendor ? `(${effectiveVendor})` : ''}
                    </Text>
                    {hasItemsToRefund && (
                        <Badge tone="warning">Refund Draft Active</Badge>
                    )}
                </InlineStack>
                
                <Bleed marginInline="400">
                    <Divider />
                </Bleed>

                <IndexTable
                resourceName={resourceName}
                itemCount={order.lineItems.length}
                headings={[
                    { title: "" },
                    { title: "Product" },
                    { title: "Price" },
                    { title: "Purchased" },
                    { title: "Refunding" },
                    { title: "Subtotal", alignment: "end" },
                ]}
                selectable={false}
                >
                {rowMarkup}
                </IndexTable>
                
                <BlockStack gap="200" align="end">
                    <div style={{ padding: "16px", textAlign: "right" }}>
                         <Text variant="headingMd" as="p">
                            Refund Amount: {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currencyCode }).format(calculatedRefundTotal)}
                        </Text>
                    </div>
                    <div style={{ paddingRight: "16px", paddingBottom: "16px" }}>
                         <Button 
                            variant="primary" 
                            disabled={!hasItemsToRefund}
                            onClick={() => setModalOpen(true)}
                        >
                            Preview Refund
                         </Button>
                    </div>
                </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section variant="oneThird">
            <Card>
                <BlockStack gap="200">
                    <Text as="h2" variant="headingSm">
                        Order Details
                    </Text>
                    <BlockStack gap="100">
                        <Text as="p" variant="bodyMd">
                            Fulfillment: <Badge tone={order.displayFulfillmentStatus === 'FULFILLED' ? 'success' : 'attention'}>{order.displayFulfillmentStatus}</Badge>
                        </Text>
                        <Text as="p" variant="bodyMd">
                            Financial: <Badge tone={order.displayFinancialStatus === 'PAID' ? 'success' : 'info'}>{order.displayFinancialStatus}</Badge>
                        </Text>
                         <Text as="p" variant="bodyMd" tone="subdued">
                            Total Order Value: {formattedTotal}
                        </Text>
                    </BlockStack>
                </BlockStack>
            </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Preview Refund"
        primaryAction={{
            content: "Create Refund (Coming Soon)",
            onAction: () => setModalOpen(false), 
            disabled: true 
        }}
        secondaryActions={[
            {
                content: "Edit",
                onAction: () => setModalOpen(false),
            }
        ]}
      >
        <Modal.Section>
            <BlockStack gap="400">
                <Text as="p">
                    You are about to create a refund for <strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currencyCode }).format(calculatedRefundTotal)}</strong>.
                </Text>
                
                <Text as="h3" variant="headingSm">Items to be refunded:</Text>
                <BlockStack gap="200">
                    {order.lineItems.map(({node}: any) => {
                        const qty = refundState[node.id];
                        if (!qty) return null;
                        return (
                            <InlineStack key={node.id} align="space-between">
                                <Text as="span">{node.title} x {qty}</Text>
                                <Text as="span">{(parseFloat(node.variant?.price || "0") * qty).toFixed(2)} {order.currencyCode}</Text>
                            </InlineStack>
                        )
                    })}
                </BlockStack>
                
                <Divider />
                <InlineStack align="space-between">
                    <Text as="span" fontWeight="bold">Total Refund</Text>
                     <Text as="span" fontWeight="bold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currencyCode }).format(calculatedRefundTotal)}</Text>
                </InlineStack>
            </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
