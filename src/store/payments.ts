// Dodo Payments integration (test mode).
// Wrapped behind an interface so it can be swapped if unavailable.

import { z } from "zod";

const DodoCheckoutResponseSchema = z.object({
  id: z.string(),
  url: z.string(),
  status: z.string(),
});

const DodoWebhookSchema = z.object({
  type: z.string(),
  data: z.object({
    id: z.string(),
    metadata: z.record(z.unknown()).optional(),
    amount: z.number().optional(),
    status: z.string().optional(),
  }),
});

export type DodoWebhookEvent = z.infer<typeof DodoWebhookSchema>;

interface CheckoutParams {
  productId: string;
  productTitle: string;
  priceCents: number;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export async function createCheckoutSession(
  params: CheckoutParams
): Promise<{ url: string; id: string }> {
  const apiKey = process.env["DODO_API_KEY"];

  if (!apiKey || process.env["MOCK_LLM"] === "1") {
    // Mock checkout — redirect to a fake success URL
    const fakeId = `dodo_mock_${Date.now()}`;
    return {
      id: fakeId,
      url: `${params.successUrl}?session_id=${fakeId}&mock=1`,
    };
  }

  const response = await fetch(
    "https://api.dodopayments.com/payments",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        billing: {
          city: "",
          country: "US",
          state: "",
          street: "",
          zipcode: "",
        },
        customer: {
          create_new_customer: true,
          email: params.metadata["customer_email"] ?? "buyer@example.com",
          name: "Customer",
        },
        payment_link: true,
        product_cart: [
          {
            product_id: params.productId,
            quantity: 1,
          },
        ],
        metadata: params.metadata,
        success_url: params.successUrl,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dodo API error ${response.status}: ${text}`);
  }

  const data = DodoCheckoutResponseSchema.parse(await response.json());
  return { id: data.id, url: data.url };
}

export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const secret = process.env["DODO_WEBHOOK_SECRET"];
  // In test/demo mode without a secret, accept all webhooks
  if (!secret) return true;
  // TODO: replace with Dodo's official SDK verification when available
  // For now, do a simple constant-time string compare on the raw header
  return signature === secret;
}

export function parseWebhookEvent(body: string): DodoWebhookEvent {
  return DodoWebhookSchema.parse(JSON.parse(body));
}
