# User System Fixes - Implementation Status

## Overview
Implementation of paper claiming, direct metadata editing, and related features identified in the audit.

---

## ✅ COMPLETED - Database Layer

### 1. Migration 023: Paper Claiming System
**File:** `/src/migrations/023_paper_claiming_system.sql`
**Status:** ✅ Run successfully

**Created:**
- `paper_claims` table - Tracks ownership claims with verification
- `is_claimed` and `claimed_at` columns on `research_items`
- Automatic trigger to update `research_items` when claim approved
- Indexes for performance
- Support for ORCID verification, email domain matching, manual review

### 2. Migration 024: Metadata History & Direct Editing
**File:** `/src/migrations/024_metadata_history_and_direct_editing.sql`
**Status:** ✅ Run successfully

**Created:**
- `metadata_history` table - Full audit trail of all changes
- `metadata_edit_permissions` table - Permission levels
- `last_edited_by`, `last_edited_at`, `edit_count` columns on `compass_metadata`
- Automatic trigger to log all metadata changes
- Support for tracking owner vs. peer-reviewed edits

---

## ✅ COMPLETED - API Routes

### File: `/src/routes/research.js`
**Status:** ✅ Routes added

**New Endpoints:**
```javascript
// Paper claiming
POST   /research/:id/claim                    - Claim a paper as your own
GET    /research/claims/my-claims             - View your claims
GET    /research/claims/pending               - View pending claims (admin)
PUT    /research/claims/:id/review            - Approve/reject claim (admin)

// Direct metadata editing
PUT    /research/:id/metadata                 - Edit metadata directly (owner only)
GET    /research/:id/metadata-history         - View change history
```

---

## ⚠️ PENDING - Controller Implementation

### File: `/src/controllers/researchController.js`
**Status:** ⚠️ Needs implementation

The following controller methods need to be added. Here are the specifications:

### 1. `claimPaper` - POST /research/:id/claim

**Purpose:** Allow researchers to claim papers as their own

**Request Body:**
```javascript
{
  claim_notes: "I am the corresponding author...",  // Optional explanation
  orcid_id: "0000-0001-2345-6789"                   // Optional ORCID for verification
}
```

**Logic:**
1. Check paper exists and is not already claimed
2. Check user hasn't already claimed this paper
3. Attempt automatic verification:
   - If ORCID provided → check if matches paper authors
   - Check if user's email domain matches paper institution
4. Create claim with appropriate status:
   - `approved` if auto-verified
   - `pending` if manual review needed
5. If auto-approved, immediately update `research_items.user_id`

**Response:**
```javascript
{
  success: true,
  claim: { id, status, verification_method },
  message: "Paper claimed successfully" | "Claim submitted for review"
}
```

---

### 2. `getMyClaims` - GET /research/claims/my-claims

**Purpose:** View all claims submitted by the logged-in user

**Query Params:**
- `status`: pending|approved|rejected (optional filter)

**Response:**
```javascript
{
  success: true,
  claims: [
    {
      id: "claim-uuid",
      research_id: "paper-uuid",
      paper_title: "Example Paper",
      claim_status: "approved",
      verification_method: "orcid_match",
      claimed_at: "2025-01-12T...",
      reviewed_at: "2025-01-12T...",
      review_notes: "..."
    }
  ]
}
```

---

### 3. `getPendingClaims` - GET /research/claims/pending

**Purpose:** View all pending claims (admin only)

**Authorization:** Requires `is_admin = true`

**Response:**
```javascript
{
  success: true,
  claims: [
    {
      id: "claim-uuid",
      research: { id, title, authors },
      claimant: { id, name, email, orcid_id },
      claim_notes: "...",
      verification_data: {},
      claimed_at: "2025-01-12T..."
    }
  ]
}
```

---

### 4. `reviewClaim` - PUT /research/claims/:id/review

**Purpose:** Approve or reject a paper claim (admin only)

**Authorization:** Requires `is_admin = true`

**Request Body:**
```javascript
{
  action: "approve" | "reject",
  review_notes: "Verified via institutional email"  // Optional
}
```

**Logic:**
1. Update `paper_claims` with status and review info
2. If approved → trigger will auto-update `research_items.user_id`
3. Send notification to claimant

**Response:**
```javascript
{
  success: true,
  claim: { id, claim_status, reviewed_at },
  message: "Claim approved" | "Claim rejected"
}
```

---

### 5. `updateMetadataDirectly` - PUT /research/:id/metadata

**Purpose:** Direct metadata edit for paper owners (bypass peer review)

**Authorization:** Must be paper owner (`research_items.user_id = req.user.id`)

**Request Body:**
```javascript
{
  framework_alignment: ["SDG 13", "CBD"],
  geo_scope_text: "Southeast Asia",
  taxon_scope: ["Panthera tigris"],
  ecosystem_type: "Tropical Forests",
  methods: ["Camera Traps", "Field Surveys"],
  threat_types: ["Habitat Loss", "Poaching"],
  conservation_actions: ["Protected Areas"],
  change_reason: "Adding missing conservation actions"  // Optional
}
```

**Logic:**
1. Verify user owns the paper
2. Set PostgreSQL session variable: `SET LOCAL app.current_user_id = ?`
3. Update `compass_metadata` table
4. Trigger will automatically log changes to `metadata_history`
5. Update `last_edited_by`, `last_edited_at`, `edit_count`

**Response:**
```javascript
{
  success: true,
  metadata: { /* updated metadata */ },
  message: "Metadata updated successfully"
}
```

---

### 6. `getMetadataHistory` - GET /research/:id/metadata-history

**Purpose:** View all metadata changes for a paper

**Response:**
```javascript
{
  success: true,
  history: [
    {
      id: "history-uuid",
      edited_by: { id, name },
      edit_type: "direct_edit",
      field_name: "conservation_actions",
      old_value: ["Protected Areas"],
      new_value: ["Protected Areas", "Community-Based Conservation"],
      is_owner_edit: true,
      created_at: "2025-01-12T..."
    }
  ]
}
```

---

## 🔄 Additional Features to Implement

### 7. Duplicate Detection on Submission

**File:** `submitResearch` function in `researchController.js`

**Enhancement:** Before inserting new paper, check if it already exists:

```javascript
// Check for existing paper by DOI
if (doi) {
  const existing = await pool.query(
    'SELECT id, user_id FROM research_items WHERE doi = $1',
    [doi]
  );

  if (existing.rows.length > 0) {
    const paper = existing.rows[0];
    if (!paper.user_id) {
      // Suggest claiming instead
      return res.status(409).json({
        error: 'Paper already exists in database',
        suggestion: 'claim_paper',
        paper_id: paper.id,
        message: 'This paper is already in our database. Would you like to claim it as your own?'
      });
    } else {
      return res.status(409).json({
        error: 'Paper already exists and is claimed',
        message: 'This paper is already in the database and belongs to another researcher.'
      });
    }
  }
}
```

---

## 🧪 Testing Checklist

### Paper Claiming
- [ ] User can claim unclaimed paper with valid ORCID → auto-approved
- [ ] User can claim paper without ORCID → pending review
- [ ] Admin can view pending claims
- [ ] Admin can approve/reject claims
- [ ] User cannot claim same paper twice
- [ ] User cannot claim already-claimed paper
- [ ] Approved claim updates `research_items.user_id`

### Direct Metadata Editing
- [ ] Paper owner can edit metadata directly
- [ ] Non-owner cannot edit metadata directly
- [ ] Metadata changes are logged in history
- [ ] Metadata history shows all changes with timestamps
- [ ] Edit count increments correctly
- [ ] PostgreSQL trigger logs changes automatically

### Duplicate Detection
- [ ] Submitting duplicate DOI suggests claiming instead
- [ ] Submitting duplicate claimed paper shows error
- [ ] Submitting paper without DOI works normally

---

## 📊 Database Schema Reference

### paper_claims
```sql
id UUID PRIMARY KEY
research_id UUID → research_items.id
claimant_id UUID → users.id
claim_status VARCHAR(20)  -- pending, approved, rejected
verification_method VARCHAR(50)  -- orcid_match, email_domain, manual_review
verification_data JSONB
claim_notes TEXT
reviewed_by UUID → users.id
review_notes TEXT
claimed_at TIMESTAMP
reviewed_at TIMESTAMP
```

### metadata_history
```sql
id UUID PRIMARY KEY
research_id UUID → research_items.id
edited_by UUID → users.id
edit_type VARCHAR(50)  -- direct_edit, suggestion_approved, ai_generated, bulk_import
field_name VARCHAR(100)
old_value JSONB
new_value JSONB
change_reason TEXT
is_owner_edit BOOLEAN
created_at TIMESTAMP
```

### metadata_edit_permissions
```sql
id UUID PRIMARY KEY
user_id UUID → users.id
permission_level VARCHAR(50)  -- owner_only, trusted_editor, admin
granted_by UUID → users.id
granted_at TIMESTAMP
```

---

## 🎯 Next Steps

1. **Implement Controller Methods** (2-4 hours)
   - Add 6 controller functions to `researchController.js`
   - Test each endpoint with Postman/curl
   - Handle edge cases and errors

2. **Add Validation Schemas** (30 minutes)
   - Update `/middleware/validation.js` with schemas for:
     - `claimPaper` request body
     - `reviewClaim` request body
     - `updateMetadataDirectly` request body

3. **Add Frontend Integration** (separate task)
   - Create claim paper button on paper pages
   - Admin panel for reviewing claims
   - Metadata editor for paper owners
   - Metadata history timeline view

4. **Documentation** (30 minutes)
   - API documentation for new endpoints
   - User guide for claiming papers
   - Admin guide for reviewing claims

---

## 🚀 Estimated Timeline

- **Database & Routes:** ✅ COMPLETE (2 hours)
- **Controller Implementation:** ⚠️ TODO (2-4 hours)
- **Testing:** TODO (2 hours)
- **Frontend:** TODO (6-8 hours)

**Total remaining:** ~10-14 hours of development work

---

*Last Updated: 2025-01-12*
*Implementation by: Claude Code*
