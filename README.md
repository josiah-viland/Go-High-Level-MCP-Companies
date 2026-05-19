# GHL Businesses MCP Server

Exposes the GoHighLevel Businesses API as MCP tools so Claude can create,
update, search, and link companies directly in conversation.

## Tools exposed to Claude

| Tool | What it does |
|------|-------------|
| `list_businesses` | Page through all companies in your GHL account |
| `search_business_by_name` | Find a company by name |
| `get_business` | Get full details for a company by ID |
| `create_business` | Create a new company record |
| `update_business` | Enrich/update an existing company (phone, address, website, etc.) |
| `delete_business` | Delete a company record |
| `link_contact_to_business` | Associate a contact with a company |
| `unlink_contact_from_business` | Remove a contact-company association |
| `get_contacts_by_business` | List all contacts linked to a company |
| `bulk_link_contacts_to_business` | Link all contacts matching a company name at once |

---

## Deploy to Render (step by step)

### Step 1 — Push code to GitHub

1. Go to [github.com](https://github.com) and sign in (or create a free account)
2. Click **+** → **New repository**
3. Name it `ghl-businesses-mcp`, set to **Private**, click **Create repository**
4. On your Mac, open Terminal and run:

```bash
cd ~/Downloads
# If you don't have git installed, run: xcode-select --install first
git init ghl-businesses-mcp
cd ghl-businesses-mcp
# Copy the three files (index.js, package.json, README.md) into this folder
# Then:
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/ghl-businesses-mcp.git
git push -u origin main
```

> Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username shown in the URL after you created the repo.

---

### Step 2 — Create a Render Web Service

1. Go to [render.com](https://render.com) and sign up (free — use GitHub login)
2. Click **New +** → **Web Service**
3. Click **Connect a repository** → select `ghl-businesses-mcp`
4. Fill in the settings:

| Field | Value |
|-------|-------|
| **Name** | `ghl-businesses-mcp` |
| **Region** | US East (or closest to you) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

5. Click **Advanced** to expand environment variables, then click **Add Environment Variable** for each:

| Key | Value |
|-----|-------|
| `GHL_API_KEY` | `pit-9f0a982d-b213-4d27-866d-0d496001668b` |
| `GHL_LOCATION_ID` | `HRPYUwgB7JID4RyKRoD9` |
| `MCP_SECRET` | Make up a random password, e.g. `homelyft-mcp-2024` — save it, you'll need it |

6. Click **Create Web Service**

Render will build and deploy — takes about 2 minutes. You'll see a green **Live** badge when it's done.

7. Copy your service URL — it will look like:
   `https://ghl-businesses-mcp.onrender.com`

---

### Step 3 — Test the deployment

Open your browser and visit:
```
https://ghl-businesses-mcp.onrender.com/health
```

You should see:
```json
{"status":"ok","server":"ghl-businesses-mcp","version":"1.0.0"}
```

---

### Step 4 — Connect to Claude

1. Go to [claude.ai](https://claude.ai) → click your profile → **Settings**
2. Click **Integrations** → **Add custom integration**
3. Fill in:

| Field | Value |
|-------|-------|
| **Name** | `GHL Businesses` |
| **URL** | `https://ghl-businesses-mcp.onrender.com/sse` |
| **Authentication** | Bearer token |
| **Token** | The `MCP_SECRET` value you set above |

4. Click **Save** — Claude will verify the connection

---

### Step 5 — Use it

In any Claude conversation you can now say things like:

- *"Search for High Tide Plumbing in GHL and link Lindsay Gruber's contact to it"*
- *"Update Paul Davis Restoration with phone 228-351-0484, address 14471 US-49 N Gulfport MS 39503"*
- *"List all companies in GHL that don't have a phone number"*
- *"Link all contacts whose companyName is 'Allen Plumbing' to the Allen Plumbing business record"*

---

## Notes

- **Free tier on Render** spins down after 15 minutes of inactivity — the first request after a spin-down takes ~30 seconds. Upgrade to the $7/mo Starter tier if you want it always-on.
- Your GHL API key and location ID are stored as Render environment variables and never exposed in code.
- The `MCP_SECRET` protects your server so only Claude (with your token) can call it.
