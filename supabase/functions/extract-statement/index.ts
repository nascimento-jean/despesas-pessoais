const allowedOrigins = new Set([
  "https://nascimento-jean.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://nascimento-jean.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function responseText(payload: any) {
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405, origin);

  const authorization = request.headers.get("Authorization");
  const apiKey = request.headers.get("apikey");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!authorization || !apiKey || !supabaseUrl) return json({ error: "Autenticação necessária" }, 401, origin);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: apiKey },
  });
  if (!userResponse.ok) return json({ error: "Sessão inválida" }, 401, origin);
  const user = await userResponse.json();

  const { text, selectedMonth, categories } = await request.json();
  if (typeof text !== "string" || text.length < 20) return json({ error: "Texto insuficiente" }, 400, origin);
  if (text.length > 70000) return json({ error: "Fatura muito extensa" }, 413, origin);

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "Análise avançada indisponível" }, 503, origin);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      issuer: { type: "string" },
      dueDate: { type: ["string", "null"], description: "YYYY-MM-DD ou null" },
      invoiceTotal: { type: ["number", "null"] },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            description: { type: "string" },
            value: { type: "number" },
            category: { type: "string", enum: Array.isArray(categories) ? categories : ["Outros"] },
            installment: { type: "integer", minimum: 1 },
            totalInstallments: { type: "integer", minimum: 1 },
            credit: { type: "boolean" },
            ignored: { type: "boolean" },
            confidence: { type: "string", enum: ["alta", "média", "baixa"] },
          },
          required: ["date", "description", "value", "category", "installment", "totalInstallments", "credit", "ignored", "confidence"],
        },
      },
    },
    required: ["issuer", "dueDate", "invoiceTotal", "items"],
  };

  const prompt = `Extraia lançamentos de uma fatura brasileira de cartão.
Período de referência: ${selectedMonth}.
Retorne cada compra, tarifa e IOF como item. Marque pagamentos, saldo anterior,
totais, limites e linhas de cabeçalho como ignored=true. Estornos e valores a
crédito devem ter credit=true. Não invente dados ausentes. Preserve a descrição
útil do estabelecimento. Datas devem usar YYYY-MM-DD; quando o ano estiver
ausente, inferir pelo período de referência e pela sequência da fatura.

TEXTO EXTRAÍDO:
${text}`;

  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "low" },
      safety_identifier: `statement-user-${user.id}`,
      input: prompt,
      text: { format: { type: "json_schema", name: "card_statement", strict: true, schema } },
    }),
  });
  if (!openaiResponse.ok) {
    const requestId = openaiResponse.headers.get("x-request-id");
    return json({ error: "A análise avançada falhou", requestId }, 502, origin);
  }

  const payload = await openaiResponse.json();
  const extracted = responseText(payload);
  try {
    return json(JSON.parse(extracted), 200, origin);
  } catch {
    return json({ error: "Resposta de análise inválida" }, 502, origin);
  }
});
