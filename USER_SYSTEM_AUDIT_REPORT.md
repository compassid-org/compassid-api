# COMPASSID User System Audit Report

**Date:** January 2025
**Audited By:** Claude Code
**Scope:** User authentication, paper management, metadata system, and profile management

---

## Executive Summary

This audit examines the COMPASSID user account system, focusing on paper submission, claiming, metadata management, and user profile functionality. The system has a solid foundation but **lacks critical features** for paper claiming, ownership transfer, and comprehensive metadata editing that users need.

### Critical Findings:
- ✅ **AUTH SYSTEM**: Solid JWT-based authentication with proper security
- ✅ **PROFILE MANAGEMENT**: Comprehensive profile updates working correctly
- ❌ **PAPER CLAIMING**: **MISSING** - No functionality for users to claim existing papers
- ❌ **PAPER OWNERSHIP**: **INCOMPLETE** - Can submit but cannot claim/transfer ownership
- ⚠️ **METADATA EDITING**: **LIMITED** - Can suggest but cannot directly edit AI-generated labels
- ⚠️ **PAPER SUBMISSION**: Works but missing validation and duplicate detection

---

## 1. Authentication & User Account System

### ✅ What Works Well

**Registration (`authController.js:14-55`)**
- Secure password hashing with bcrypt (12 rounds)
- Generates unique COMPASS ID for each user
- JWT token with 7-day expiration
- Proper HTTP-only cookies in production

**Login (`authController.js:57-111`)**
- Validates credentials securely
- Supports admin users with `is_admin` flag
- Returns comprehensive user object with subscription tier
- Proper error handling for invalid credentials

**Profile Management (`authController.js:150-210`)**
- Comprehensive profile update endpoint
- Supports all user fields:
  - Basic info (first_name, last_name, institution, ORCID)
  - Academic info (bio, position, department, location)
  - Links (website, Google Scholar)
  - Research interests
  - Employment and education history (JSONB)
- Proper authentication check via JWT middleware

### Database Schema (`001_initial_schema.sql:4-14`)

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    orcid_id VARCHAR(19),
    first_name, last_name, institution VARCHAR,
    created_at, updated_at TIMESTAMP
);
```

**Additional fields** (added in migrations):
- `compass_id` - Unique identifier for researchers
- `subscription` - Tier level (free, researcher, pro, grant_writer)
- `subscription_status` - Active/inactive
- `is_admin` - Admin flag
- `bio`, `position`, `department`, `location` - Academic profile
- `website`, `google_scholar_url` - External links
- `research_interests` - JSONB array
- `employment`, `education` - JSONB arrays for CV sections
- `avatar_url` - Profile picture

### ⚠️ Issues Found

**1. No Email Verification**
- Users can register without verifying email
- **Risk**: Spam accounts, invalid emails in database
- **Recommendation**: Add email verification flow

**2. No Password Reset**
- No "Forgot Password" functionality
- **Impact**: Users locked out if they forget password
- **Recommendation**: Implement password reset via email

**3. No Account Deletion**
- Users cannot delete their own accounts
- **Legal**: GDPR/privacy compliance issue
- **Recommendation**: Add DELETE `/auth/account` endpoint

**4. Missing Profile Validation**
- ORCID ID not validated (should be 16 digits with optional hyphens)
- URLs not validated
- **Recommendation**: Add validation middleware

---

## 2. Paper Submission System

### ✅ What Works

**Submit Research (`researchController.js:6-115`)**
- Users can submit papers with:
  - DOI, title, abstract, year, journal, authors
  - Optional: compass_metadata (manual)
- **AI Metadata Generation**: If metadata not provided, uses Claude AI to extract:
  - Ecosystem types
  - Research methods
  - Taxonomic coverage
  - Frameworks (SDGs, CBD, etc.)
  - Geographic scope
  - Temporal range
- Papers stored in `research_items` table
- Metadata stored in `compass_metadata` table
- Proper transaction handling (BEGIN/COMMIT/ROLLBACK)

### ❌ CRITICAL GAPS

**1. NO PAPER CLAIMING SYSTEM**

Users **CANNOT** claim papers already in the database as their own.

**Current State:**
- 500K+ papers in database from bulk imports (PubMed, CrossRef, OpenAlex)
- All papers have `user_id` set to NULL or import user
- Researchers cannot claim their published papers

**What's Needed:**
```javascript
// POST /research/:id/claim
// Allows authenticated user to claim an existing paper as theirs
```

**Implementation Requirements:**
1. Verify paper exists and is unclaimed (user_id IS NULL)
2. Verify user is legitimate author (name matching, ORCID check)
3. Update `research_items.user_id` to claiming user
4. Send notification/confirmation
5. Log claim action for audit

**Database Changes Needed:**
```sql
-- Add claiming audit table
CREATE TABLE paper_claims (
    id UUID PRIMARY KEY,
    paper_id UUID REFERENCES research_items(id),
    user_id UUID REFERENCES users(id),
    status VARCHAR(20), -- 'pending', 'approved', 'rejected'
    verification_method VARCHAR(50), -- 'orcid', 'email', 'manual'
    claimed_at TIMESTAMP,
    verified_at TIMESTAMP,
    verified_by UUID REFERENCES users(id)
);
```

**2. NO OWNERSHIP TRANSFER**

Users cannot transfer paper ownership to another user.

**What's Needed:**
```javascript
// POST /research/:id/transfer
// Transfer ownership to another user (e.g., if claimed by wrong person)
```

**3. NO DUPLICATE DETECTION**

System doesn't check if paper already exists before submission.

**What's Needed:**
- Check DOI before inserting
- Check title similarity (fuzzy matching)
- Prevent duplicate submissions
- Suggest existing paper for claiming instead

**4. NO BULK IMPORT FOR USERS**

Researchers cannot bulk-import their publication list (e.g., from ORCID, Google Scholar).

**What's Needed:**
```javascript
// POST /research/bulk-import
// Import papers from ORCID or Google Scholar profile
```

---

## 3. Metadata Management System

### ✅ What Works

**Metadata Suggestions (`metadata_suggestions` table)**
- Users can suggest metadata improvements for papers
- Peer review system for suggestions
- Tracks who suggested, who reviewed
- Status tracking: pending, approved, rejected

**Suggestion Routes (`research.js:18-19`)**
```javascript
router.put('/:id/suggest', authenticateToken, researchController.suggestMetadata);
router.post('/suggestions/:id/review', authenticateToken, researchController.reviewSuggestion);
```

### ❌ CRITICAL GAPS

**1. CANNOT DIRECTLY EDIT METADATA**

Paper owners **CANNOT** directly edit their paper's metadata - they can only suggest changes.

**Current Flow:**
1. User submits paper → AI generates metadata
2. User sees AI-generated labels (e.g., "Grasslands & Savannas", "Camera Traps")
3. User wants to change it → Must submit suggestion
4. Suggestion goes to review queue
5. Someone else must approve it

**Problem:** Own papers should be directly editable!

**What's Needed:**
```javascript
// PUT /research/:id/metadata
// Direct metadata update for paper owners (bypass suggestion system)
{
  ecosystem_type: "Marine & Coastal",
  methods: ["eDNA", "Field Surveys"],
  taxon_scope: ["Coral Reefs", "Fish"],
  framework_alignment: ["SDG 14"],
  geo_scope_text: "Great Barrier Reef, Australia"
}
```

**Implementation:**
```javascript
const updateMetadata = async (req, res) => {
  // 1. Check if user owns the paper
  const paper = await pool.query(
    'SELECT user_id FROM research_items WHERE id = $1',
    [req.params.id]
  );

  if (paper.rows[0].user_id !== req.user.userId && !req.user.is_admin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // 2. Update metadata directly
  await pool.query(
    `UPDATE compass_metadata
     SET framework_alignment = $1,
         taxon_scope = $2,
         methods = $3,
         ecosystem_type = $4,
         geo_scope_text = $5,
         updated_at = NOW()
     WHERE research_id = $6`,
    [...]
  );

  res.json({ success: true });
};
```

**2. NO METADATA VERSION HISTORY**

When metadata is updated, previous versions are lost.

**What's Needed:**
```sql
CREATE TABLE metadata_history (
    id UUID PRIMARY KEY,
    research_id UUID REFERENCES research_items(id),
    metadata_snapshot JSONB, -- Full metadata at this version
    changed_by UUID REFERENCES users(id),
    change_type VARCHAR(50), -- 'ai_generated', 'user_edit', 'suggestion_approved'
    created_at TIMESTAMP
);
```

**3. NO BULK METADATA EDIT**

Users cannot edit metadata for multiple papers at once (e.g., "add SDG 15 to all my papers about forests").

**What's Needed:**
```javascript
// POST /research/bulk-update-metadata
// Update metadata for multiple papers owned by user
{
  paper_ids: [uuid1, uuid2, uuid3],
  add_frameworks: ["SDG 15"],
  add_methods: ["Remote Sensing"]
}
```

**4. LIMITED METADATA FIELDS IN UI**

Current metadata schema has many fields, but UI may not expose all:
- `threat_types` (Habitat Loss, Climate Change, etc.)
- `conservation_actions` (Protected Areas, Restoration, etc.)
- `study_types` (Field Study, Meta-Analysis, etc.)

**Check:** Frontend should allow editing ALL metadata fields.

---

## 4. Saved Papers System

### ✅ What Works (`papersController.js`)

**Save Paper to Library**
- Users can save papers to their personal library
- Store custom notes and tags
- Organize into folders with colors
- Works well for bookmarking

**Folder Management**
- Create folders with names, descriptions, colors
- Add/remove papers from folders
- Get folder with paper counts

### Database Schema
```sql
CREATE TABLE saved_papers (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    paper_title TEXT,
    paper_doi VARCHAR,
    paper_authors JSONB,
    paper_year INT,
    paper_journal VARCHAR,
    paper_abstract TEXT,
    paper_url VARCHAR,
    notes TEXT,  -- User's personal notes
    tags JSONB,  -- User's custom tags
    created_at TIMESTAMP
);

CREATE TABLE paper_folders (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    name VARCHAR UNIQUE,
    description TEXT,
    color VARCHAR,  -- Hex color for UI
    created_at TIMESTAMP
);

CREATE TABLE paper_folder_assignments (
    paper_id UUID REFERENCES saved_papers(id),
    folder_id UUID REFERENCES paper_folders(id),
    PRIMARY KEY (paper_id, folder_id)
);
```

### ⚠️ Issues

**1. SAVED PAPERS vs RESEARCH ITEMS CONFUSION**

There are TWO separate paper systems:
1. **`research_items`** - Papers submitted by users (own research)
2. **`saved_papers`** - Papers bookmarked from database

**Problem:** These should be linked!

- A user should be able to save a `research_item` to their library
- Currently `saved_papers` duplicates data instead of referencing `research_items`

**Recommendation:**
```sql
-- Option 1: Link saved_papers to research_items
ALTER TABLE saved_papers ADD COLUMN research_item_id UUID REFERENCES research_items(id);

-- Option 2: Create unified bookmark system
CREATE TABLE paper_bookmarks (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    research_item_id UUID REFERENCES research_items(id),
    notes TEXT,
    tags JSONB,
    created_at TIMESTAMP
);
```

**2. NO LINK TO RESEARCH DATABASE**

When saving a paper, it doesn't check if it already exists in `research_items`.

**What's Needed:**
- Before inserting into `saved_papers`, check if DOI exists in `research_items`
- If exists, link to it instead of duplicating
- This enables claiming: "This paper in your saved library is in our database - claim it!"

---

## 5. Missing Features Roadmap

### HIGH PRIORITY (Implement First)

#### 1. Paper Claiming System
**User Story:** "I published 20 papers on tiger conservation. They're in your database but not linked to my account. I want to claim them."

**Implementation:**
- [ ] Add `POST /research/:id/claim` endpoint
- [ ] Create `paper_claims` table for audit trail
- [ ] Add verification methods:
  - ORCID ID matching
  - Email verification (send code to paper author's email)
  - Manual admin review for ambiguous cases
- [ ] UI: "Claim This Paper" button on paper detail page
- [ ] UI: "My Claimed Papers" page in user dashboard
- [ ] Notification when claim is approved

**Estimated Time:** 2-3 days

#### 2. Direct Metadata Editing (for owners)
**User Story:** "This is my paper and AI labeled it wrong. I want to fix it immediately, not wait for peer review."

**Implementation:**
- [ ] Add `PUT /research/:id/metadata` endpoint
- [ ] Check ownership: `paper.user_id === req.user.userId` or admin
- [ ] Update `compass_metadata` directly (bypass suggestions)
- [ ] Log edit in `metadata_history` table
- [ ] UI: "Edit Metadata" button (only for owners)
- [ ] UI: Metadata edit form with all fields

**Estimated Time:** 1-2 days

#### 3. Duplicate Detection
**User Story:** "I tried to submit my paper but it's already in the database. I want to claim it instead."

**Implementation:**
- [ ] Before inserting, check DOI in `research_items`
- [ ] If exists, return: `{ exists: true, paper_id: uuid, message: "This paper already exists. Would you like to claim it?" }`
- [ ] Frontend: Show "Claim Paper" button instead of error
- [ ] Optional: Fuzzy title matching for papers without DOI

**Estimated Time:** 1 day

### MEDIUM PRIORITY (Implement Second)

#### 4. Bulk Import from ORCID/Google Scholar
**User Story:** "I have 50 publications. I don't want to add them one by one."

**Implementation:**
- [ ] Add `POST /research/bulk-import` endpoint
- [ ] Support ORCID API integration
- [ ] Support Google Scholar scraping (or manual CSV upload)
- [ ] For each paper:
  - Check if exists (DOI matching)
  - If exists: claim it
  - If not exists: import and claim
- [ ] Show progress bar during import
- [ ] Show summary: "Claimed 30 papers, imported 20 new papers"

**Estimated Time:** 3-4 days

#### 5. Metadata Version History
**User Story:** "Someone changed my paper's metadata and I want to see who and revert it."

**Implementation:**
- [ ] Create `metadata_history` table
- [ ] Log every metadata change (AI, user edit, suggestion approval)
- [ ] Add `/research/:id/metadata/history` endpoint
- [ ] UI: "View History" button showing timeline
- [ ] UI: "Revert to Version" button

**Estimated Time:** 2 days

#### 6. Account Management
**User Story:** "I want to delete my account" / "I forgot my password"

**Implementation:**
- [ ] Add `POST /auth/forgot-password` endpoint
- [ ] Send reset email with token
- [ ] Add `POST /auth/reset-password` endpoint
- [ ] Add `DELETE /auth/account` endpoint
- [ ] Anonymize user data (GDPR compliance)
- [ ] Option: Delete all papers or keep them anonymized

**Estimated Time:** 2-3 days

### LOW PRIORITY (Nice to Have)

#### 7. Bulk Metadata Editing
**User Story:** "I want to add 'SDG 15' to all my 20 forest papers at once."

**Implementation:**
- [ ] Add `POST /research/bulk-update-metadata` endpoint
- [ ] Accept array of paper IDs + metadata changes
- [ ] Verify user owns all papers
- [ ] Apply changes to all papers
- [ ] Return success/failure summary

**Estimated Time:** 1-2 days

#### 8. Collaborative Paper Management
**User Story:** "My co-author and I both want to manage this paper's metadata."

**Implementation:**
- [ ] Add `paper_collaborators` table
- [ ] Allow paper owner to add collaborators
- [ ] Collaborators get same edit permissions
- [ ] Show "Shared with: John Doe, Jane Smith" on paper

**Estimated Time:** 2-3 days

#### 9. Paper Ownership Transfer
**User Story:** "I accidentally claimed my colleague's paper. I want to transfer it to them."

**Implementation:**
- [ ] Add `POST /research/:id/transfer` endpoint
- [ ] Require recipient's email or COMPASS ID
- [ ] Send transfer request notification
- [ ] Recipient accepts/declines
- [ ] Update `user_id` on acceptance

**Estimated Time:** 2 days

---

## 6. Database Schema Recommendations

### New Tables Needed

```sql
-- 1. Paper Claims (for claiming existing papers)
CREATE TABLE paper_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    research_item_id UUID NOT NULL REFERENCES research_items(id),
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    verification_method VARCHAR(50), -- orcid, email, manual
    verification_data JSONB, -- Store verification details
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP,
    verified_by UUID REFERENCES users(id),
    rejection_reason TEXT
);

-- 2. Metadata History (version control for metadata)
CREATE TABLE metadata_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    research_id UUID NOT NULL REFERENCES research_items(id),
    metadata_snapshot JSONB NOT NULL, -- Full compass_metadata as JSON
    changed_by UUID REFERENCES users(id),
    change_type VARCHAR(50), -- ai_generated, user_edit, suggestion_approved, admin_edit
    change_description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Paper Collaborators (shared ownership)
CREATE TABLE paper_collaborators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    research_item_id UUID NOT NULL REFERENCES research_items(id),
    user_id UUID NOT NULL REFERENCES users(id),
    added_by UUID NOT NULL REFERENCES users(id),
    permission_level VARCHAR(20) DEFAULT 'edit', -- view, edit, admin
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(research_item_id, user_id)
);

-- 4. Password Reset Tokens
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Email Verification
CREATE TABLE email_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Schema Modifications Needed

```sql
-- Add fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- Add fields to research_items table
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN DEFAULT FALSE;
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS original_source VARCHAR(50); -- pubmed, crossref, openalex, user_submission

-- Add index for faster DOI lookups (duplicate detection)
CREATE INDEX IF NOT EXISTS idx_research_doi_lower ON research_items(LOWER(doi));

-- Add fields to compass_metadata for tracking
ALTER TABLE compass_metadata ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES users(id);
ALTER TABLE compass_metadata ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;
ALTER TABLE compass_metadata ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN DEFAULT TRUE;
```

---

## 7. API Endpoints Needed

### Paper Claiming

```javascript
// Claim an existing paper
POST /api/research/:id/claim
Auth: Required
Body: {
  verification_method: 'orcid' | 'email' | 'manual',
  verification_data: { /* method-specific data */ }
}
Response: {
  success: true,
  claim_id: uuid,
  status: 'pending' | 'approved',
  message: "Claim submitted for review"
}

// Get user's claimed papers
GET /api/research/my-claims
Auth: Required
Response: {
  claims: [{
    id: uuid,
    paper: { /* research_item data */ },
    status: 'pending',
    claimed_at: timestamp
  }]
}

// Get claims pending review (admin)
GET /api/research/claims/pending
Auth: Required (admin)
Response: { claims: [...] }

// Approve/reject claim (admin)
POST /api/research/claims/:id/review
Auth: Required (admin)
Body: {
  action: 'approve' | 'reject',
  reason: "Optional rejection reason"
}
```

### Metadata Management

```javascript
// Direct metadata update (owner only)
PUT /api/research/:id/metadata
Auth: Required
Body: {
  framework_alignment: [...]
  taxon_scope: [...],
  methods: [...],
  ecosystem_type: "...",
  geo_scope_text: "...",
  temporal_start: "YYYY-MM-DD",
  temporal_end: "YYYY-MM-DD"
}
Response: { success: true }

// Get metadata history
GET /api/research/:id/metadata/history
Response: {
  history: [{
    id: uuid,
    changed_by: {name, email},
    change_type: "user_edit",
    changes: { /* diff */ },
    created_at: timestamp
  }]
}

// Revert to previous version
POST /api/research/:id/metadata/revert
Auth: Required (owner/admin)
Body: { history_id: uuid }
Response: { success: true }

// Bulk metadata update
POST /api/research/bulk-update-metadata
Auth: Required
Body: {
  paper_ids: [uuid1, uuid2, ...],
  changes: {
    add_frameworks: ["SDG 15"],
    remove_methods: ["Camera Traps"],
    set_ecosystem: "Tropical Forests"
  }
}
Response: {
  success: true,
  updated: 15,
  failed: 0,
  errors: []
}
```

### Bulk Import

```javascript
// Import papers from ORCID
POST /api/research/bulk-import/orcid
Auth: Required
Body: { orcid_id: "0000-0002-1234-5678" }
Response: {
  success: true,
  imported: 20,
  claimed: 30,
  skipped: 5,
  papers: [...]
}

// Import papers from CSV
POST /api/research/bulk-import/csv
Auth: Required
Body: FormData with CSV file
CSV Format: doi, title, year, journal, authors
Response: { imported: 50, errors: [] }
```

### Account Management

```javascript
// Request password reset
POST /api/auth/forgot-password
Body: { email: "user@example.com" }
Response: { success: true, message: "Reset email sent" }

// Reset password
POST /api/auth/reset-password
Body: {
  token: "reset-token-from-email",
  new_password: "newpass123"
}
Response: { success: true }

// Delete account
DELETE /api/auth/account
Auth: Required
Body: { password: "confirm-password" }
Response: { success: true, message: "Account deleted" }

// Verify email
GET /api/auth/verify-email/:token
Response: { success: true, message: "Email verified" }

// Resend verification email
POST /api/auth/resend-verification
Auth: Required
Response: { success: true }
```

---

## 8. Testing Checklist

### Manual Testing Needed

**Authentication**
- [ ] Register new user
- [ ] Login with correct credentials
- [ ] Login with wrong password (should fail)
- [ ] Update profile with all fields
- [ ] Update profile with invalid ORCID (should fail with validation)
- [ ] Logout and verify token is cleared

**Paper Submission**
- [ ] Submit paper with full metadata
- [ ] Submit paper with DOI only (AI should generate metadata)
- [ ] Submit duplicate DOI (should detect and suggest claiming)
- [ ] Submit paper without required fields (should fail with validation)
- [ ] View submitted paper in "My Research"

**Paper Claiming (Once Implemented)**
- [ ] Search for paper by author name
- [ ] Click "Claim This Paper"
- [ ] Verify with ORCID
- [ ] Check claim appears in "My Claims"
- [ ] Admin approves claim
- [ ] Paper now appears in "My Research"

**Metadata Editing (Once Implemented)**
- [ ] Open owned paper
- [ ] Click "Edit Metadata"
- [ ] Change ecosystem type
- [ ] Add new framework (SDG 15)
- [ ] Remove a method
- [ ] Save changes
- [ ] Verify changes reflected immediately
- [ ] Check history shows edit with username

**Saved Papers**
- [ ] Save paper to library
- [ ] Add custom notes and tags
- [ ] Create folder
- [ ] Add paper to folder
- [ ] View folder with papers
- [ ] Remove paper from folder
- [ ] Delete saved paper

---

## 9. Security Recommendations

### Current Security (Good)
- ✅ JWT tokens with HTTP-only cookies
- ✅ Password hashing with bcrypt (12 rounds)
- ✅ CORS configuration
- ✅ Rate limiting on auth endpoints

### Improvements Needed
- [ ] **Input Validation**: Add validation for all user inputs (email format, ORCID format, URLs, etc.)
- [ ] **SQL Injection Protection**: Use parameterized queries everywhere (currently good, maintain this)
- [ ] **XSS Protection**: Sanitize user-generated content (bio, notes, tags)
- [ ] **CSRF Protection**: Add CSRF tokens for state-changing requests
- [ ] **Role-Based Access Control (RBAC)**: Implement proper permission system for admin/user/reviewer roles
- [ ] **Audit Logging**: Log all sensitive actions (claims, metadata edits, account changes)
- [ ] **API Rate Limiting**: Extend rate limiting beyond auth to all endpoints
- [ ] **File Upload Security**: If adding avatar upload, validate file types and scan for malware

---

## 10. Priority Implementation Plan

### Week 1: Paper Claiming (HIGH PRIORITY)
- Day 1-2: Database schema + migrations for `paper_claims` table
- Day 3-4: Backend API endpoints for claiming
- Day 5: Frontend UI for "Claim Paper" button

### Week 2: Direct Metadata Editing (HIGH PRIORITY)
- Day 1: Ownership check middleware
- Day 2: Backend endpoint for direct metadata update
- Day 3-4: Frontend metadata edit form
- Day 5: Testing and bug fixes

### Week 3: Duplicate Detection + History (MEDIUM PRIORITY)
- Day 1-2: Duplicate detection logic + DOI indexing
- Day 3: Metadata history table + logging
- Day 4-5: History UI + revert functionality

### Week 4: Account Management (MEDIUM PRIORITY)
- Day 1-2: Password reset flow (email + token)
- Day 3: Email verification
- Day 4: Account deletion
- Day 5: Testing + security review

### Month 2: Bulk Import + Advanced Features (LOW PRIORITY)
- Week 1: ORCID API integration
- Week 2: CSV upload for bulk import
- Week 3: Bulk metadata editing
- Week 4: Collaborative paper management

---

## 11. Conclusion

The COMPASSID user system has a solid foundation but **critical gaps** prevent users from fully managing their research:

### Must Fix Immediately:
1. **Paper Claiming** - Users need to claim their existing publications
2. **Direct Metadata Editing** - Owners should edit their papers without peer review
3. **Duplicate Detection** - Prevent duplicate submissions and guide users to claim instead

### Should Fix Soon:
4. Account management (password reset, email verification, deletion)
5. Metadata version history
6. Bulk import from ORCID/Google Scholar

### Nice to Have:
7. Bulk metadata editing
8. Collaborative paper management
9. Advanced search in user's papers

**Estimated Total Development Time:** 6-8 weeks for all high and medium priority features.

---

**Next Steps:**
1. Review this audit with the team
2. Prioritize features based on user feedback
3. Create detailed tickets for each feature
4. Begin implementation starting with paper claiming

**Contact:** For questions about this audit, reach out to the development team.

