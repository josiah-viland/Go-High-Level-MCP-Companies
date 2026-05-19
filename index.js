/**
 * GHL Businesses MCP Server
 * Exposes GoHighLevel Businesses API as MCP tools for Claude
 * Transport: SSE (Server-Sent Events) for remote hosting on Render
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  SSEServerTransport,
} = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");

// ── Configuration ─────────────────────────────────────────────────────────────
const GHL_API_KEY  = process.env.GHL_API_KEY;
const LOCATION_ID  = process.env.GHL_LOCATION_ID;
const PORT         = process.env.PORT || 3000;
const MCP_SECRET   = process.env.MCP_SECRET || null; // Optional auth token

if (!GHL_API_KEY || !LOCATION_ID) {
  console.error("ERROR: GHL_API_KEY and GHL_LOCATION_ID env vars are required");
  process.exit(1);
}

// ── GHL API Helpers ───────────────────────────────────────────────────────────
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_API_KEY}`,
  "Content-Type":  "application/json",
  "Version":       "2021-07-28",
};

async function ghlRequest(method, path, body = null) {
  const opts = { method, headers: GHL_HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${GHL_BASE}${path}`, opts);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`GHL API ${resp.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// ── MCP Server Setup ──────────────────────────────────────────────────────────
function createMcpServer() {
  const server = new McpServer({
    name:    "ghl-businesses",
    version: "1.0.0",
  });

  // ── Tool: list_businesses ─────────────────────────────────────────────────
  server.tool(
    "list_businesses",
    "List all companies/businesses in GHL. Paginates automatically. Use page parameter to get subsequent pages.",
    {
      page:  z.number().optional().describe("Page number (default: 1)"),
      limit: z.number().optional().describe("Results per page, max 100 (default: 100)"),
      search: z.string().optional().describe("Filter by name (partial match)"),
    },
    async ({ page = 1, limit = 100, search }) => {
      const params = new URLSearchParams({
        locationId: LOCATION_ID,
        limit:      Math.min(limit, 100),
        skip:       (page - 1) * Math.min(limit, 100),
      });
      if (search) params.set("name", search);

      const data = await ghlRequest("GET", `/businesses/?${params}`);
      const businesses = data.businesses || [];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total:      data.total || businesses.length,
            page,
            count:      businesses.length,
            businesses: businesses.map(b => ({
              id:          b.id,
              name:        b.name,
              phone:       b.phone,
              email:       b.email,
              address:     b.address,
              city:        b.city,
              state:       b.state,
              postalCode:  b.postalCode,
              website:     b.website,
              description: b.description,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool: get_business ───────────────────────────────────────────────────
  server.tool(
    "get_business",
    "Get full details for a specific GHL company/business by ID",
    {
      business_id: z.string().describe("The GHL business ID"),
    },
    async ({ business_id }) => {
      const data = await ghlRequest("GET", `/businesses/${business_id}`);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data.business || data, null, 2),
        }],
      };
    }
  );

  // ── Tool: search_business_by_name ────────────────────────────────────────
  server.tool(
    "search_business_by_name",
    "Search for a GHL company/business by name. Returns matching businesses.",
    {
      name: z.string().describe("Company name to search for"),
    },
    async ({ name }) => {
      // Page through all businesses and find matches
      const matches = [];
      let skip = 0;
      while (true) {
        const params = new URLSearchParams({
          locationId: LOCATION_ID,
          limit: 100,
          skip,
        });
        const data = await ghlRequest("GET", `/businesses/?${params}`);
        const businesses = data.businesses || [];
        if (!businesses.length) break;

        const nameLower = name.toLowerCase();
        for (const b of businesses) {
          if ((b.name || "").toLowerCase().includes(nameLower)) {
            matches.push({ id: b.id, name: b.name, phone: b.phone,
              email: b.email, city: b.city, state: b.state });
          }
        }

        const total = data.total || businesses.length;
        skip += businesses.length;
        if (skip >= total) break;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: matches.length, matches }, null, 2),
        }],
      };
    }
  );

  // ── Tool: create_business ────────────────────────────────────────────────
  server.tool(
    "create_business",
    "Create a new company/business record in GHL",
    {
      name:        z.string().describe("Company name (required)"),
      phone:       z.string().optional().describe("Phone number in E.164 format, e.g. +12285551234"),
      email:       z.string().optional().describe("Email address"),
      website:     z.string().optional().describe("Website URL"),
      address:     z.string().optional().describe("Street address"),
      city:        z.string().optional().describe("City"),
      state:       z.string().optional().describe("State abbreviation, e.g. MS"),
      postalCode:  z.string().optional().describe("ZIP/postal code"),
      description: z.string().optional().describe("Description or notes about the company"),
    },
    async ({ name, phone, email, website, address, city, state, postalCode, description }) => {
      const payload = { name, locationId: LOCATION_ID };
      if (phone)       payload.phone       = phone;
      if (email)       payload.email       = email;
      if (website)     payload.website     = website;
      if (address)     payload.address     = address;
      if (city)        payload.city        = city;
      if (state)       payload.state       = state;
      if (postalCode)  payload.postalCode  = postalCode;
      if (description) payload.description = description;

      const data = await ghlRequest("POST", "/businesses/", payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data.business || data, null, 2),
        }],
      };
    }
  );

  // ── Tool: update_business ────────────────────────────────────────────────
  server.tool(
    "update_business",
    "Update an existing company/business record in GHL. Only provided fields are updated.",
    {
      business_id: z.string().describe("The GHL business ID to update"),
      name:        z.string().optional().describe("New company name"),
      phone:       z.string().optional().describe("Phone number in E.164 format"),
      email:       z.string().optional().describe("Email address"),
      website:     z.string().optional().describe("Website URL"),
      address:     z.string().optional().describe("Street address"),
      city:        z.string().optional().describe("City"),
      state:       z.string().optional().describe("State abbreviation"),
      postalCode:  z.string().optional().describe("ZIP/postal code"),
      description: z.string().optional().describe("Description or notes"),
    },
    async ({ business_id, ...fields }) => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) payload[k] = v;
      }
      const data = await ghlRequest("PUT", `/businesses/${business_id}`, payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data.business || data, null, 2),
        }],
      };
    }
  );

  // ── Tool: delete_business ────────────────────────────────────────────────
  server.tool(
    "delete_business",
    "Delete a company/business record from GHL",
    {
      business_id: z.string().describe("The GHL business ID to delete"),
    },
    async ({ business_id }) => {
      const data = await ghlRequest("DELETE", `/businesses/${business_id}`);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, result: data }, null, 2),
        }],
      };
    }
  );

  // ── Tool: link_contact_to_business ───────────────────────────────────────
  server.tool(
    "link_contact_to_business",
    "Associate a GHL contact with a company/business record",
    {
      contact_id:  z.string().describe("The GHL contact ID"),
      business_id: z.string().describe("The GHL business ID"),
    },
    async ({ contact_id, business_id }) => {
      const data = await ghlRequest(
        "POST",
        `/contacts/${contact_id}/business`,
        { businessId: business_id }
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, result: data }, null, 2),
        }],
      };
    }
  );

  // ── Tool: unlink_contact_from_business ───────────────────────────────────
  server.tool(
    "unlink_contact_from_business",
    "Remove the association between a GHL contact and their company",
    {
      contact_id:  z.string().describe("The GHL contact ID"),
      business_id: z.string().describe("The GHL business ID"),
    },
    async ({ contact_id, business_id }) => {
      const data = await ghlRequest(
        "DELETE",
        `/contacts/${contact_id}/business/${business_id}`
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, result: data }, null, 2),
        }],
      };
    }
  );

  // ── Tool: get_contacts_by_business ───────────────────────────────────────
  server.tool(
    "get_contacts_by_business",
    "Get all contacts associated with a specific GHL company/business",
    {
      business_id: z.string().describe("The GHL business ID"),
      limit:       z.number().optional().describe("Max results (default 100)"),
      skip:        z.number().optional().describe("Offset for pagination"),
    },
    async ({ business_id, limit = 100, skip = 0 }) => {
      const params = new URLSearchParams({ locationId: LOCATION_ID, limit, skip });
      const data = await ghlRequest(
        "GET",
        `/contacts/business/${business_id}?${params}`
      );
      const contacts = data.contacts || [];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total:    data.total || contacts.length,
            contacts: contacts.map(c => ({
              id:          c.id,
              name:        `${c.firstName || ""} ${c.lastName || ""}`.trim(),
              email:       c.email,
              phone:       c.phone,
              companyName: c.companyName,
              tags:        c.tags,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool: bulk_link_contacts_to_business ─────────────────────────────────
  server.tool(
    "bulk_link_contacts_to_business",
    "Link multiple contacts to a business at once by searching for contacts with a matching companyName field",
    {
      business_id:   z.string().describe("The GHL business ID"),
      company_name:  z.string().describe("Company name to match against contact companyName fields"),
    },
    async ({ business_id, company_name }) => {
      // Search contacts by company name
      const searchResp = await ghlRequest(
        "POST",
        "/contacts/search",
        {
          locationId: LOCATION_ID,
          page: 1,
          pageLimit: 100,
          filters: [],
        }
      );

      const allContacts = searchResp.contacts || [];
      const nameLower = company_name.toLowerCase();
      const matching = allContacts.filter(
        c => (c.companyName || "").toLowerCase() === nameLower && !c.businessId
      );

      const results = { linked: [], failed: [] };
      for (const c of matching) {
        try {
          await ghlRequest("POST", `/contacts/${c.id}/business`, { businessId: business_id });
          results.linked.push({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim() });
        } catch (e) {
          results.failed.push({ id: c.id, error: e.message });
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            company_name,
            business_id,
            matched:      matching.length,
            linked_count: results.linked.length,
            failed_count: results.failed.length,
            linked:       results.linked,
            failed:       results.failed,
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Optional: simple auth middleware
app.use((req, res, next) => {
  if (!MCP_SECRET) return next();
  if (req.path === "/health") return next();
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${MCP_SECRET}`) return next();
  res.status(401).json({ error: "Unauthorized" });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", server: "ghl-businesses-mcp", version: "1.0.0" });
});

// SSE endpoint — each connection gets its own transport
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(404).json({ error: "Session not found" });
  }
  await transport.handlePostMessage(req, res);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`GHL Businesses MCP server running on port ${PORT}`);
  console.log(`SSE endpoint:    /sse`);
  console.log(`Health check:    /health`);
  console.log(`Location ID:     ${LOCATION_ID}`);
  console.log(`Auth required:   ${MCP_SECRET ? "yes" : "no"}`);
});
