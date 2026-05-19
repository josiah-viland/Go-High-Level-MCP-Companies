/**
 * GHL Businesses MCP Server
 * Transport: Streamable HTTP (/mcp endpoint) â€” required for claude.ai custom connectors
 */

const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const { McpServer }                     = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const GHL_API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PORT        = process.env.PORT || 3000;
const MCP_SECRET  = process.env.MCP_SECRET || null;

if (!GHL_API_KEY || !LOCATION_ID) {
  console.error("ERROR: GHL_API_KEY and GHL_LOCATION_ID env vars are required");
  process.exit(1);
}

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_API_KEY}`,
  "Content-Type":  "application/json",
  "Version":       "2021-07-28",
};

async function ghl(method, path, body = null) {
  const opts = { method, headers: GHL_HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${GHL_BASE}${path}`, opts);
  const data = await resp.json();
  if (!resp.ok) throw new Error(`GHL ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function buildServer() {
  const server = new McpServer({ name: "ghl-businesses", version: "1.0.0" });

  server.tool("list_businesses",
    "List all companies/businesses in GHL. Use page to paginate.",
    { page: z.number().optional(), limit: z.number().optional(), search: z.string().optional() },
    async ({ page = 1, limit = 100, search }) => {
      const p = new URLSearchParams({ locationId: LOCATION_ID, limit: Math.min(limit, 100), skip: (page - 1) * Math.min(limit, 100) });
      if (search) p.set("name", search);
      const data = await ghl("GET", `/businesses/?${p}`);
      return ok({ total: data.total, page, count: (data.businesses||[]).length,
        businesses: (data.businesses||[]).map(b => ({ id: b.id, name: b.name, phone: b.phone,
          email: b.email, address: b.address, city: b.city, state: b.state,
          postalCode: b.postalCode, website: b.website })) });
    }
  );

  server.tool("search_business_by_name",
    "Search for a GHL company/business by name",
    { name: z.string() },
    async ({ name }) => {
      const matches = [];
      let skip = 0;
      while (true) {
        const p = new URLSearchParams({ locationId: LOCATION_ID, limit: 100, skip });
        const data = await ghl("GET", `/businesses/?${p}`);
        const items = data.businesses || [];
        if (!items.length) break;
        const nl = name.toLowerCase();
        for (const b of items) if ((b.name||"").toLowerCase().includes(nl))
          matches.push({ id: b.id, name: b.name, phone: b.phone, email: b.email, city: b.city, state: b.state });
        skip += items.length;
        if (skip >= (data.total || items.length)) break;
      }
      return ok({ count: matches.length, matches });
    }
  );

  server.tool("get_business",
    "Get full details for a specific GHL company by ID",
    { business_id: z.string() },
    async ({ business_id }) => {
      const data = await ghl("GET", `/businesses/${business_id}`);
      return ok(data.business || data);
    }
  );

  server.tool("create_business",
    "Create a new company/business record in GHL",
    { name: z.string(), phone: z.string().optional(), email: z.string().optional(),
      website: z.string().optional(), address: z.string().optional(), city: z.string().optional(),
      state: z.string().optional(), postalCode: z.string().optional(), description: z.string().optional() },
    async (args) => {
      const payload = { name: args.name, locationId: LOCATION_ID };
      for (const f of ["phone","email","website","address","city","state","postalCode","description"])
        if (args[f]) payload[f] = args[f];
      const data = await ghl("POST", "/businesses/", payload);
      return ok(data.business || data);
    }
  );

  server.tool("update_business",
    "Update/enrich an existing company record in GHL. Only provided fields are changed.",
    { business_id: z.string(), name: z.string().optional(), phone: z.string().optional(),
      email: z.string().optional(), website: z.string().optional(), address: z.string().optional(),
      city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(),
      description: z.string().optional() },
    async ({ business_id, ...fields }) => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) payload[k] = v;
      const data = await ghl("PUT", `/businesses/${business_id}`, payload);
      return ok(data.business || data);
    }
  );

  server.tool("delete_business",
    "Delete a company/business record from GHL",
    { business_id: z.string() },
    async ({ business_id }) => {
      const data = await ghl("DELETE", `/businesses/${business_id}`);
      return ok({ success: true, result: data });
    }
  );

  server.tool("link_contact_to_business",
    "Associate a GHL contact with a company/business record",
    { contact_id: z.string(), business_id: z.string() },
    async ({ contact_id, business_id }) => {
      const data = await ghl("POST", `/contacts/${contact_id}/business`, { businessId: business_id });
      return ok({ success: true, result: data });
    }
  );

  server.tool("unlink_contact_from_business",
    "Remove association between a contact and their company",
    { contact_id: z.string(), business_id: z.string() },
    async ({ contact_id, business_id }) => {
      const data = await ghl("DELETE", `/contacts/${contact_id}/business/${business_id}`);
      return ok({ success: true, result: data });
    }
  );

  server.tool("get_contacts_by_business",
    "Get all contacts linked to a specific GHL company",
    { business_id: z.string(), limit: z.number().optional(), skip: z.number().optional() },
    async ({ business_id, limit = 100, skip = 0 }) => {
      const p = new URLSearchParams({ locationId: LOCATION_ID, limit, skip });
      const data = await ghl("GET", `/contacts/business/${business_id}?${p}`);
      const contacts = data.contacts || [];
      return ok({ total: data.total || contacts.length,
        contacts: contacts.map(c => ({ id: c.id,
          name: `${c.firstName||""} ${c.lastName||""}`.trim(),
          email: c.email, phone: c.phone, companyName: c.companyName, tags: c.tags })) });
    }
  );

  server.tool("bulk_link_contacts_to_business",
    "Link all contacts whose companyName matches a given name to a business record",
    { business_id: z.string(), company_name: z.string() },
    async ({ business_id, company_name }) => {
      const searchResp = await ghl("POST", "/contacts/search",
        { locationId: LOCATION_ID, page: 1, pageLimit: 100, filters: [] });
      const all = searchResp.contacts || [];
      const nl = company_name.toLowerCase();
      const matching = all.filter(c => (c.companyName||"").toLowerCase() === nl && !c.businessId);
      const results = { linked: [], failed: [] };
      for (const c of matching) {
        try {
          await ghl("POST", `/contacts/${c.id}/business`, { businessId: business_id });
          results.linked.push({ id: c.id, name: `${c.firstName||""} ${c.lastName||""}`.trim() });
        } catch (e) { results.failed.push({ id: c.id, error: e.message }); }
      }
      return ok({ company_name, business_id, matched: matching.length,
        linked_count: results.linked.length, linked: results.linked, failed: results.failed });
    }
  );

  return server;
}

const app = express();
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));
app.use(express.json());

app.use((req, res, next) => {
  if (!MCP_SECRET || req.path === "/health") return next();
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (token === MCP_SECRET) return next();
  res.status(401).json({ error: "Unauthorized" });
});

app.get("/health", (_, res) =>
  res.json({ status: "ok", server: "ghl-businesses-mcp", version: "1.0.0" }));

app.all("/mcp", async (req, res) => {
  try {
    const server    = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`GHL Businesses MCP server running on port ${PORT}`);
  console.log(`MCP endpoint:  /mcp`);
  console.log(`Health check:  /health`);
  console.log(`Location ID:   ${LOCATION_ID}`);
  console.log(`Auth required: ${MCP_SECRET ? "yes" : "no"}`);
});
