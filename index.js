/**
 * GHL Businesses MCP Server
 * Transport: Streamable HTTP (/mcp endpoint) — required for claude.ai custom connectors
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
    "Update/enrich an existing company record in GHL. Only provided fields are changed. For referral_company_type use customFieldKey='business.referral_company_type' with a value like 'Plumber', 'Realtor', 'Insurance Agent', 'HVAC Contractor', 'Property Manager', 'Adjuster', 'General Contractor', 'Restoration Company', 'Pest Control'.",
    { business_id: z.string(), name: z.string().optional(), phone: z.string().optional(),
      email: z.string().optional(), website: z.string().optional(), address: z.string().optional(),
      city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(),
      description: z.string().optional(),
      customFieldKey: z.string().optional().describe("Custom field key e.g. business.referral_company_type"),
      customFieldValue: z.string().optional().describe("Value to set for the custom field") },
    async ({ business_id, customFieldKey, customFieldValue, ...fields }) => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) payload[k] = v;
      if (customFieldKey && customFieldValue !== undefined) {
        // GHL businesses API expects customFields as key-value object
        payload.customFields = { [customFieldKey]: customFieldValue };
      }
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

  // ── get_contact_notes ──────────────────────────────────────────────────
  server.tool("get_contact_notes",
    "Get all notes for a specific GHL contact",
    { contact_id: z.string(), limit: z.number().optional(), skip: z.number().optional() },
    async ({ contact_id, limit = 100, skip = 0 }) => {
      const p = new URLSearchParams({ limit, skip });
      const data = await ghl("GET", `/contacts/${contact_id}/notes?${p}`);
      const notes = data.notes || [];
      return ok({ total: data.total || notes.length,
        notes: notes.map(n => ({ id: n.id, body: n.body, dateAdded: n.dateAdded, createdBy: n.userId })) });
    }
  );

  // ── get_contact_tasks ──────────────────────────────────────────────────
  server.tool("get_contact_tasks",
    "Get all tasks for a specific GHL contact",
    { contact_id: z.string() },
    async ({ contact_id }) => {
      const data = await ghl("GET", `/contacts/${contact_id}/tasks`);
      return ok({ tasks: data.tasks || [] });
    }
  );

  // ── get_contact_appointments ───────────────────────────────────────────
  server.tool("get_contact_appointments",
    "Get all appointments/calendar events for a specific GHL contact",
    { contact_id: z.string() },
    async ({ contact_id }) => {
      const data = await ghl("GET", `/contacts/${contact_id}/appointments`);
      return ok({ appointments: data.events || data.appointments || [] });
    }
  );

  // ── get_contact_activity ───────────────────────────────────────────────
  server.tool("get_contact_activity",
    "Get full activity feed for a contact including calls, emails, SMS, notes, and other events",
    { contact_id: z.string(), limit: z.number().optional(), skip: z.number().optional() },
    async ({ contact_id, limit = 100, skip = 0 }) => {
      const p = new URLSearchParams({ limit, skip });
      const data = await ghl("GET", `/contacts/${contact_id}/activity?${p}`);
      return ok(data);
    }
  );

  // ── get_conversations ──────────────────────────────────────────────────
  server.tool("get_conversations",
    "Get all conversations (SMS, email, calls) for a specific GHL contact",
    { contact_id: z.string() },
    async ({ contact_id }) => {
      const p = new URLSearchParams({ locationId: LOCATION_ID, contactId: contact_id, limit: 20 });
      const data = await ghl("GET", `/conversations/search?${p}`);
      const convos = data.conversations || [];
      return ok({ total: data.total || convos.length, conversations: convos.map(c => ({
        id: c.id, type: c.type, lastMessage: c.lastMessage,
        lastMessageDate: c.lastMessageDate, unreadCount: c.unreadCount,
        assignedTo: c.assignedTo
      }))});
    }
  );

  // ── get_conversation_messages ─────────────────────────────────────────
  server.tool("get_conversation_messages",
    "Get all messages in a specific conversation (SMS, email, calls, etc.)",
    { conversation_id: z.string(), limit: z.number().optional() },
    async ({ conversation_id, limit = 100 }) => {
      const p = new URLSearchParams({ limit });
      const data = await ghl("GET", `/conversations/${conversation_id}/messages?${p}`);
      const messages = data.messages || data.lastMessageBody || [];
      return ok({ total: data.total, messages });
    }
  );

  // ── get_contact_full_profile ───────────────────────────────────────────
  server.tool("get_contact_full_profile",
    "Get complete contact profile including all custom fields, tags, and metadata. Use this for reporting and summaries.",
    { contact_id: z.string() },
    async ({ contact_id }) => {
      const data = await ghl("GET", `/contacts/${contact_id}`);
      const c = data.contact || data;
      return ok({
        id: c.id, name: `${c.firstName||""} ${c.lastName||""}`.trim(),
        email: c.email, phone: c.phone, companyName: c.companyName,
        address: c.address1, city: c.city, state: c.state, postalCode: c.postalCode,
        tags: c.tags, source: c.source, type: c.type,
        assignedTo: c.assignedTo, businessId: c.businessId,
        dateAdded: c.dateAdded, dateUpdated: c.dateUpdated,
        customFields: c.customFields || [],
        additionalEmails: c.additionalEmails || [],
        website: c.website, dnd: c.dnd,
      });
    }
  );

  // ── get_opportunities ─────────────────────────────────────────────────
  server.tool("get_opportunities",
    "Get all opportunities in GHL. Can filter by contact, pipeline, or status. Use for sales reporting.",
    { contact_id: z.string().optional(), pipeline_id: z.string().optional(),
      status: z.enum(["open","won","lost","abandoned","all"]).optional(),
      limit: z.number().optional(), page: z.number().optional() },
    async ({ contact_id, pipeline_id, status = "all", limit = 100, page = 1 }) => {
      const p = new URLSearchParams({ location_id: LOCATION_ID, limit, page, status });
      if (contact_id)  p.set("contact_id", contact_id);
      if (pipeline_id) p.set("pipeline_id", pipeline_id);
      const data = await ghl("GET", `/opportunities/search?${p}`);
      const opps = data.opportunities || [];
      return ok({ total: data.total || opps.length, page,
        opportunities: opps.map(o => ({
          id: o.id, name: o.name, status: o.status,
          monetaryValue: o.monetaryValue, pipelineId: o.pipelineId,
          pipelineStageId: o.pipelineStageId, pipelineStageName: o.pipelineStage?.name,
          assignedTo: o.assignedTo?.name, contactName: o.contact?.name,
          dateAdded: o.dateAdded, dateUpdated: o.updatedAt,
          customFields: o.customFields || [],
        }))});
    }
  );

  // ── get_pipelines ─────────────────────────────────────────────────────
  server.tool("get_pipelines",
    "Get all sales pipelines and their stages in GHL",
    {},
    async () => {
      const data = await ghl("GET", `/opportunities/pipelines?locationId=${LOCATION_ID}`);
      return ok(data);
    }
  );

  // ── get_custom_fields ─────────────────────────────────────────────────
  server.tool("get_custom_fields",
    "Get all custom field definitions for contacts in GHL — shows field IDs, names, keys, and allowed values",
    { model: z.enum(["contact","opportunity","all"]).optional() },
    async ({ model = "contact" }) => {
      const data = await ghl("GET", `/locations/${LOCATION_ID}/customFields?model=${model}`);
      return ok(data);
    }
  );

  // ── search_contacts ────────────────────────────────────────────────────
  server.tool("search_contacts",
    "Search GHL contacts by name, email, phone, or company name. Returns full profiles for reporting.",
    { query: z.string(), limit: z.number().optional(), page: z.number().optional() },
    async ({ query, limit = 20, page = 1 }) => {
      const data = await ghl("POST", "/contacts/search", {
        locationId: LOCATION_ID, page, pageLimit: limit,
        filters: [], sort: [{ field: "dateAdded", direction: "desc" }],
        searchAfter: query ? undefined : undefined,
      });
      // GHL search doesn't filter by query in POST, use GET for name search
      const p = new URLSearchParams({ locationId: LOCATION_ID, query, limit });
      const data2 = await ghl("GET", `/contacts/?${p}`);
      const contacts = data2.contacts || [];
      return ok({ total: data2.meta?.total || contacts.length,
        contacts: contacts.map(c => ({
          id: c.id, name: `${c.firstName||""} ${c.lastName||""}`.trim(),
          email: c.email, phone: c.phone, companyName: c.companyName,
          tags: c.tags, businessId: c.businessId,
          customFields: c.customFields || [],
          dateAdded: c.dateAdded,
        }))});
    }
  );

  return server;
}

const app = express();
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));
app.use(express.json());

// Auth disabled — claude.ai cannot send Bearer tokens to custom connectors
// The Render URL + HTTPS provides sufficient protection

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
  console.log(`Auth required: no (claude.ai compatible)`);
});
