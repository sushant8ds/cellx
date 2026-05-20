# Requirements Document

## Introduction

The Universal Dynamic Data & Calibration Platform is a cloud-based, multi-tenant SaaS web application targeting industrial and manufacturing companies. It replaces static spreadsheets and rigid legacy software with a no-code, highly configurable data management platform. Users can import existing Excel data, dynamically define their own database schema, build custom calculation formulas, automate compliance alerts, and export reports — all without writing code.

The platform addresses three core pain points: rigid workflows, data silos and migration friction, and delayed compliance tracking.

---

## Glossary

- **Platform**: The Universal Dynamic Data & Calibration Platform SaaS application.
- **Tenant**: A single industrial or manufacturing company with its own isolated data environment.
- **Admin**: A user role with full access to configure dynamic fields, formulas, billing, and tenant settings.
- **Manager**: A user role that can add records, trigger manual alerts, and view dashboards.
- **Operator**: A user role that can only update the status of assigned tasks or gauges.
- **Schema**: The set of dynamic columns and field types defined by an Admin for a Tenant's dataset.
- **Record**: A single row of data within a Tenant's dataset.
- **Dynamic Field**: A user-defined column added to the Schema without requiring a database migration.
- **Formula**: A user-defined calculation rule that derives a field value from other fields in the same Record.
- **Importer**: The subsystem responsible for parsing and mapping uploaded Excel or CSV files.
- **Mapper**: The UI component that allows users to map source file columns to Schema fields.
- **Alert Rule**: A user-configured condition that triggers a notification when met.
- **Notification Daemon**: The background service that evaluates Alert Rules and dispatches email notifications.
- **Audit Log**: An immutable record of every data modification, including actor, timestamp, old value, and new value.
- **Dashboard**: The real-time summary view displaying widget counts for record statuses.
- **Grid**: The live, searchable, filterable data table displaying all Records for a Tenant.
- **Configurator**: The admin workspace UI for managing Schema, formulas, import mappings, and notification rules.
- **Report**: An exported file (Excel or PDF) containing filtered Record data.

---

## Requirements

### Requirement 1: Multi-Tenant Architecture and Data Isolation

**User Story:** As a company Admin, I want my company's data to be completely isolated from other companies, so that sensitive operational data is never exposed to unauthorized tenants.

#### Acceptance Criteria

1. THE Platform SHALL enforce strict data isolation between Tenants at the database query level, ensuring no query can return Records belonging to a different Tenant.
2. WHEN a user authenticates, THE Platform SHALL associate the session exclusively with that user's Tenant and reject any request referencing a different Tenant's resources.
3. IF a request attempts to access a resource belonging to a different Tenant, THEN THE Platform SHALL return an authorization error and log the attempt.
4. THE Platform SHALL support onboarding a new Tenant without affecting the data or configuration of existing Tenants.

---

### Requirement 2: Secure Authentication and Role-Based Access Control (RBAC)

**User Story:** As an Admin, I want to assign roles to users so that each person can only perform actions appropriate to their responsibility level.

#### Acceptance Criteria

1. THE Platform SHALL store all user passwords using a cryptographic hashing algorithm with a per-user salt.
2. WHEN a user submits login credentials, THE Platform SHALL authenticate the user and issue a session token valid for a configurable duration.
3. IF a user submits invalid credentials, THEN THE Platform SHALL reject the login and increment a failed-attempt counter without revealing which credential was incorrect.
4. THE Platform SHALL enforce the following role permissions:
   - Admin: full access to Schema configuration, formula builder, Alert Rules, billing, and all Records.
   - Manager: access to add Records, trigger manual alerts, and view the Dashboard and Grid.
   - Operator: access limited to updating the status field of Records assigned to that Operator.
5. WHEN a user attempts an action outside their role's permissions, THE Platform SHALL deny the action and return a permission error.
6. THE Platform SHALL allow an Admin to create, deactivate, and reassign roles for users within the same Tenant.
7. THE Platform SHALL support SAML 2.0 and OAuth 2.0 Single Sign-On (SSO) integrations, allowing Tenants to enforce centralized authentication and provisioning through enterprise identity providers (e.g., Azure Active Directory, Okta, Google Workspace).
8. WHEN a Tenant enables SSO, THE Platform SHALL delegate authentication to the configured identity provider and map IdP group claims to Platform roles (Admin, Manager, Operator).

---

### Requirement 3: Universal Excel and CSV Importer

**User Story:** As an Admin or Manager, I want to upload my existing Excel or CSV files, so that I can migrate historical data into the platform without manual re-entry.

#### Acceptance Criteria

1. WHEN a user uploads a file, THE Importer SHALL accept files in `.xlsx` and `.csv` formats up to 50 MB in size.
2. WHEN a valid file is uploaded, THE Importer SHALL parse the file, detect column headers from the first row, and infer a data type (Text, Integer, Float, Date, or Status) for each column based on the column's values.
3. IF a file is malformed, password-protected, or in an unsupported format, THEN THE Importer SHALL reject the file and return a descriptive error message identifying the problem.
4. AFTER parsing, THE Mapper SHALL present each detected source column alongside its inferred data type and allow the user to map it to an existing Schema field or define a new Dynamic Field.
5. WHEN the user confirms the mapping and initiates import, THE Importer SHALL insert all valid rows as Records and report the count of successfully imported rows and the count of skipped rows with reasons.
6. IF a source row contains a value that cannot be coerced to the mapped field's data type, THEN THE Importer SHALL skip that row, record the error, and continue processing remaining rows.
7. FOR ALL valid source files, parsing then exporting then re-importing the exported file SHALL produce a Record set equivalent to the original import (round-trip property).

---

### Requirement 4: Dynamic Schema Engine

**User Story:** As an Admin, I want to define and modify the data structure of my dataset on the fly, so that I can adapt the platform to my specific operational needs without developer support.

#### Acceptance Criteria

1. THE Platform SHALL allow an Admin to add a new Dynamic Field to the Schema by specifying a field name and one of the supported types: Text, Integer, Float, Date, or Dropdown/Status (with configurable values: Safe, Warning, Danger).
2. WHEN a new Dynamic Field is added, THE Platform SHALL make that field available on all existing and future Records within the Tenant without requiring a database migration or system downtime.
3. THE Platform SHALL allow an Admin to rename a Dynamic Field, with the rename reflected consistently across all Records, Formulas, and Alert Rules that reference that field.
4. WHEN an Admin deletes a Dynamic Field, THE Platform SHALL remove the field and its data from all Records and invalidate any Formulas or Alert Rules that reference the deleted field, notifying the Admin of affected rules.
5. THE Platform SHALL enforce that Dynamic Field names are unique within a Tenant's Schema.
6. THE Platform SHALL support a minimum of 200 Dynamic Fields per Tenant Schema.
7. WHEN a Record or Dynamic Field is deleted by a user, THE Platform SHALL perform a soft delete, marking the item as inactive but retaining the data in the database.
8. THE Platform SHALL provide a Trash/Archive view allowing an Admin to restore soft-deleted items within 30 days.
9. After 30 days, soft-deleted items SHALL be permanently purged and an Audit Log entry written.
10. WHEN creating or editing a Dynamic Field, THE Platform SHALL allow an Admin to define optional validation constraints: Min/Max values for Integer/Float fields, character length limits for Text fields, and Past-only or Future-only constraints for Date fields.
11. WHEN a Record value violates a field's validation constraint, THE Platform SHALL reject the value and return a descriptive validation error identifying the field and the violated constraint.

---

### Requirement 5: Custom Formula Builder

**User Story:** As an Admin, I want to define calculation rules based on my dynamic fields, so that derived values like next calibration dates or remaining capacity are computed automatically.

#### Acceptance Criteria

1. THE Platform SHALL provide a formula editor that allows an Admin to define a Formula using arithmetic operators (+, -, *, /), date arithmetic (adding or subtracting integer days from a Date field), and conditional logic (IF/THEN/ELSE expressions referencing field values).
2. WHEN a Formula is saved, THE Platform SHALL validate the Formula's syntax and referenced field names, and reject the Formula with a descriptive error if validation fails.
3. WHEN a Record is created or updated, THE Platform SHALL automatically recalculate all Formulas whose referenced fields were affected and update the derived field values on that Record.
4. IF a Formula evaluation results in a division-by-zero or type mismatch error, THEN THE Platform SHALL set the derived field value to a null/error state and surface the error in the Grid for that Record.
5. THE Platform SHALL allow an Admin to edit or delete an existing Formula, with changes taking effect on subsequent Record updates.
6. FOR ALL Records, applying a Formula then reversing the input change SHALL restore the derived field to its prior computed value (inverse consistency property).

---

### Requirement 6: Automated Alert and Notification System

**User Story:** As an Admin or Manager, I want to configure alert rules based on field conditions, so that the right personnel are automatically notified before compliance deadlines are missed.

#### Acceptance Criteria

1. THE Platform SHALL allow an Admin or Manager to create an Alert Rule by specifying a target Dynamic Field, a comparison operator (equals, not equals, less than, greater than, less than or equal to, greater than or equal to), a threshold value, and one or more recipient email addresses.
2. THE Notification Daemon SHALL evaluate all active Alert Rules on a configurable schedule with a minimum resolution of 1 hour.
3. WHEN an Alert Rule's condition is met for one or more Records, THE Notification Daemon SHALL send an email notification to all configured recipients listing the affected Records and the field values that triggered the alert.
4. IF an email delivery attempt fails, THEN THE Notification Daemon SHALL retry delivery up to 3 times with exponential backoff before marking the notification as failed and logging the failure.
5. THE Platform SHALL allow a Manager or Admin to manually trigger an Alert Rule evaluation outside the scheduled cycle.
6. WHEN an Alert Rule is triggered for a Record, THE Platform SHALL record the event in the Audit Log with the rule name, affected Record identifier, and timestamp.
7. THE Platform SHALL allow an Admin to activate, deactivate, or delete Alert Rules without affecting other rules.

---

### Requirement 7: Compliance Audit Logging

**User Story:** As an Admin, I want every data change to be logged immutably, so that I can demonstrate compliance and trace the history of any Record modification.

#### Acceptance Criteria

1. WHEN any user creates, updates, or deletes a Record, THE Platform SHALL write an Audit Log entry containing: the acting user's identifier, the Tenant identifier, the affected Record identifier, the field name, the old value, the new value, and the UTC timestamp.
2. THE Platform SHALL write Audit Log entries for Schema changes (field additions, renames, deletions) and Formula changes, in addition to Record changes.
3. THE Audit Log SHALL be append-only; no user role, including Admin, SHALL be permitted to modify or delete Audit Log entries.
4. WHEN an Admin queries the Audit Log, THE Platform SHALL return results filtered by date range, user, or Record identifier within 500ms for datasets up to 1,000,000 log entries.
5. THE Platform SHALL retain Audit Log entries for a minimum of 7 years.

---

### Requirement 8: Live Database Grid

**User Story:** As a Manager or Operator, I want a fast, searchable, and filterable data table, so that I can quickly find and act on the records I'm responsible for.

#### Acceptance Criteria

1. THE Grid SHALL display all Records for the authenticated Tenant's active Schema, rendering up to 50,000 Records without UI lag (frame rendering under 100ms per interaction).
2. WHEN a user applies a search term or filter condition, THE Platform SHALL return matching Records within 500ms.
3. THE Grid SHALL support filtering by any Dynamic Field using type-appropriate operators (text contains/equals, numeric comparisons, date range, Status equals).
4. THE Grid SHALL support multi-column sorting.
5. WHEN a user edits a cell value inline in the Grid, THE Platform SHALL validate the new value against the field's data type, save the change, trigger Formula recalculation, and write an Audit Log entry — all within a single atomic operation.
6. THE Grid SHALL visually distinguish Records by their Status field value using color coding: Safe (green), Warning (yellow), Danger/Overdue (red).
7. WHEN multiple users attempt to update the same Record simultaneously, THE Platform SHALL reject the secondary update with a concurrency error, prompting the user to refresh and review the latest data before retrying. (Optimistic Concurrency Control using a version/timestamp token per Record)
8. WHEN a Record is deleted by a user, THE Platform SHALL perform a soft delete, marking the Record as inactive but retaining the data in the database.
9. THE Platform SHALL provide a Trash/Archive view allowing an Admin to restore soft-deleted Records within 30 days.
10. After 30 days, soft-deleted Records SHALL be permanently purged and an Audit Log entry written.
11. THE Grid SHALL allow users to select multiple Records and perform a bulk update to change the value of a specific Dynamic Field across all selected Records in a single atomic transaction.
12. WHEN a bulk update is performed, THE Platform SHALL write individual Audit Log entries for each affected Record.
13. THE Grid SHALL allow users to bulk soft-delete selected Records, subject to their role permissions.

---

### Requirement 9: Real-Time Dashboard

**User Story:** As a Manager or Admin, I want a summary dashboard with real-time status widgets, so that I can immediately see the operational health of my facility.

#### Acceptance Criteria

1. THE Dashboard SHALL display widget counts for the following status categories: Safe, Near Limit (Warning), Calibration Required, and Overdue, derived from the current state of all Records.
2. WHEN the underlying Record data changes, THE Dashboard SHALL reflect the updated counts within 30 seconds without requiring a manual page refresh.
3. THE Dashboard SHALL allow a user to click a status widget to navigate to the Grid pre-filtered to Records matching that status category.
4. WHILE a user's session is active, THE Dashboard SHALL poll or subscribe to data updates at a maximum interval of 30 seconds.

---

### Requirement 10: Configurator Workspace

**User Story:** As an Admin, I want a single no-code workspace to manage all platform configuration, so that I can set up and maintain the platform without engineering support.

#### Acceptance Criteria

1. THE Configurator SHALL provide a unified UI section accessible only to Admins that consolidates: Schema management (Dynamic Fields), Formula Builder, Import/Mapper, and Alert Rule configuration.
2. WHEN an Admin makes a configuration change in the Configurator, THE Platform SHALL apply the change and confirm success or surface a descriptive error within 5 seconds.
3. THE Configurator SHALL display a list of all active Formulas and Alert Rules with their current status (active/inactive/error).
4. IF a configuration change would invalidate an existing Formula or Alert Rule, THEN THE Configurator SHALL warn the Admin before applying the change and require explicit confirmation.

---

### Requirement 11: Report Export

**User Story:** As a Manager or Admin, I want to export filtered data to Excel or PDF, so that I can share operational reports with stakeholders who don't have platform access.

#### Acceptance Criteria

1. THE Platform SHALL allow a Manager or Admin to export the current Grid view (including active filters and sort order) to `.xlsx` or `.pdf` format.
2. WHEN an export is requested, THE Platform SHALL generate the file and make it available for download within 30 seconds for datasets up to 10,000 Records.
3. THE exported file SHALL include all visible columns, applied filter criteria as a header annotation, the Tenant name, and the export timestamp.
4. FOR ALL valid Grid states, exporting to `.xlsx` then re-importing the exported file SHALL produce Records with field values equivalent to the exported data (round-trip property).

---

### Requirement 12: Data Reliability and Backup

**User Story:** As an Admin, I want my data to be backed up automatically, so that I can recover from accidental data loss or system failure.

#### Acceptance Criteria

1. THE Platform SHALL perform automated full database backups on a daily schedule.
2. WHEN a backup completes, THE Platform SHALL verify the backup's integrity and log the result with a timestamp.
3. IF a backup fails, THEN THE Platform SHALL alert the platform operations team and retry the backup within 1 hour.
4. THE Platform SHALL retain daily backups for a minimum of 30 days.

---

### Requirement 13: Performance and Scalability

**User Story:** As a Manager, I want the platform to remain responsive under heavy data loads, so that my team's productivity is not impacted as our dataset grows.

#### Acceptance Criteria

1. THE Platform SHALL support a minimum of 50,000 active Records per Tenant without degradation in Grid rendering or query response times.
2. WHEN a search or filter query is executed against a dataset of 50,000 Records, THE Platform SHALL return results within 500ms under normal operating conditions.
3. THE Platform SHALL support a minimum of 100 concurrent authenticated users per Tenant without exceeding the 500ms query response threshold.
4. WHILE the system is under peak load, THE Platform SHALL maintain availability of at least 99.5% measured on a monthly basis.

---

### Requirement 14: RESTful API Access

**User Story:** As an Admin or integration developer, I want a secure programmatic API, so that I can integrate the platform with external systems and automate data operations without using the web UI.

#### Acceptance Criteria

1. THE Platform SHALL expose a secure RESTful API secured by API keys scoped per Tenant.
2. THE API SHALL allow Tenants to programmatically perform CRUD operations on their Records, query the Schema, and trigger Alert Rule evaluations.
3. WHEN an API request is made with an invalid or expired API key, THE Platform SHALL return a 401 Unauthorized response and log the attempt.
4. All API operations SHALL be subject to the same RBAC and tenant isolation rules as the web UI.
5. THE Platform SHALL allow an Admin to generate, rotate, and revoke API keys from the Configurator.

---

### Requirement 15: Smart Data Preprocessing and Cleaning

**User Story:** As an Admin or Manager, I want the platform to automatically detect and clean data quality issues in my uploaded files, so that I can migrate from Excel confidently without spending hours manually fixing data before import.

#### Acceptance Criteria

1. WHEN a file is uploaded for import, THE Importer SHALL automatically run a preprocessing scan and detect the following issue categories per column: missing values, type mismatches, duplicate rows, and inconsistent formats (e.g., mixed date formats, mixed numeric separators).
2. AFTER scanning, THE Platform SHALL present a Preprocessing Report to the user before import is confirmed, listing: total rows scanned, count of issues detected per category, and a row-level preview of up to 50 affected rows with the detected issue highlighted.
3. THE Platform SHALL automatically apply the following cleaning operations when the user confirms import: standardize date formats to ISO 8601, normalize numeric separators (remove thousands separators, standardize decimal point), trim leading/trailing whitespace from text values, and remove exact duplicate rows (all field values identical).
4. WHEN automatic cleaning is applied, THE Preprocessing Report SHALL list each cleaning action taken, identifying the affected column, the original value, and the corrected value, so the user can review what was changed.
5. THE Platform SHALL allow the user to manually override any automatically corrected value in the Preprocessing Report before confirming the final import.
6. IF a row contains a missing value in a column mapped to a required Dynamic Field, THEN THE Importer SHALL flag that row in the Preprocessing Report and allow the user to either provide a default fill value or skip the row.
7. WHEN the import is confirmed after preprocessing, THE Importer SHALL record the preprocessing summary (rows corrected, duplicates removed, issues flagged) as metadata on the `background_jobs` record for that import job.
8. FOR ALL preprocessing operations, applying cleaning then re-exporting then re-importing the cleaned data SHALL produce a Record set equivalent to the post-cleaning import (idempotency property).

---

### Requirement 16: AI Orchestration Agent (Text-to-Software)

**User Story:** As an Admin, I want to describe what I need in plain language after uploading my data, so that the platform automatically configures my schema, formulas, and alert rules without me having to manually build anything.

#### Acceptance Criteria

1. WHEN a user uploads a file, THE Platform SHALL automatically generate a lightweight data profile (column names, inferred types, sample values from the first 50 rows) and make it available to the AI agent as context.
2. THE Platform SHALL provide a chat interface where the user can describe their desired system in natural language (e.g., "Track overdue machine calibrations and alert the floor manager when capacity drops below 10%").
3. WHEN the user sends a message, THE Platform SHALL send the data profile and conversation history to a configured LLM (OpenAI GPT-4o or Anthropic Claude) with a system prompt that describes the available API actions.
4. THE AI agent SHALL use function calling to autonomously invoke the platform's own REST API endpoints (`POST /schema/fields`, `POST /formulas`, `POST /alert-rules`) on behalf of the user to build the requested configuration.
5. WHEN the AI agent takes an action (e.g., creates a field or formula), THE Platform SHALL display a real-time activity log in the chat interface showing exactly what was created, so the user can review and undo if needed.
6. THE Platform SHALL allow the user to refine the AI-generated configuration through follow-up messages (e.g., "Change the alert threshold to 15%" or "Add a field for the technician's name").
7. IF the AI agent cannot fulfill a request (e.g., ambiguous instructions or unsupported operation), THEN THE Platform SHALL respond with a clear explanation and ask the user for clarification.
8. THE AI agent SHALL operate within the same RBAC and tenant isolation rules as a human Admin — it SHALL NOT access or modify data belonging to other tenants.

---

### Requirement 17: Universal Constraint-Based Assignment Engine

**User Story:** As any operational manager, I want to upload any set of resources (people, rooms, machines, time slots, items) with their attributes and constraints, describe my assignment rules in plain language, and have the platform automatically generate an optimal, conflict-free assignment schedule — exportable as a printable document.

#### Acceptance Criteria

1. THE Platform SHALL accept any combination of the following as inputs for assignment generation, all defined through the Dynamic Schema Engine:
   - **Resources to assign** (e.g., staff, machines, vehicles, products) — uploaded as records with attributes such as capacity, category, availability flags, priority level, or any custom field
   - **Slots to fill** (e.g., time slots, locations, shifts, rooms, dates) — defined as records with capacity, type, and availability
   - **Items to distribute** (e.g., students, tasks, orders, patients) — with grouping fields (e.g., roll number range, department, priority)
   - **Constraint rules** — defined as dynamic fields and formulas (e.g., min/max assignments per resource, exclusion rules, grouping rules, capacity limits)

2. THE Platform SHALL provide a **Constraint Rule Builder** where the user can define assignment rules without writing code:
   - Min/max assignment count per resource (e.g., "new staff: 4–6 duties", "machine: max 8 hours/day")
   - Exclusion rules (e.g., "same resource cannot be in two simultaneous slots")
   - Grouping rules (e.g., "items 101–134 go to Room A", "all items in category X go to Slot 1")
   - Priority rules (e.g., "assign senior resources to high-priority slots first")
   - Custom formula-based rules using the existing Formula Engine

3. WHEN the user triggers generation, THE Platform SHALL run a constraint-satisfaction solver that:
   - Assigns all items to slots respecting all defined constraint rules
   - Distributes load fairly across resources (no resource hits maximum while others are below minimum)
   - Detects and resolves conflicts automatically where possible
   - Completes within a configurable time limit (default: 30 seconds for up to 10,000 items)

4. THE Platform SHALL support any domain without domain-specific hardcoding — the same engine handles exam scheduling, shift planning, room booking, delivery routing, machine maintenance scheduling, or any other assignment problem by changing only the schema and constraint rules.

5. WHEN generation is complete, THE Platform SHALL produce:
   - An **assignment matrix** (resource × slot grid) showing all assignments
   - A **distribution summary** (per-resource assignment count vs. min/max limits)
   - A **conflict report** listing any unresolvable constraints with the reason
   - An exportable document (PDF or Excel) in a user-configurable template format

6. THE Platform SHALL allow the user to manually override any auto-generated assignment in the Live Grid before exporting, with the system re-validating constraints after each override and highlighting violations.

7. IF the solver cannot satisfy all hard constraints (e.g., not enough resources for a slot), THE Platform SHALL produce a partial assignment, flag the unresolved slots, and surface them to the user for manual resolution.

8. THE AI Agent (Requirement 16) SHALL be able to configure the entire assignment setup — schema fields, constraint rules, and solver parameters — from a plain-language description (e.g., "I have 21 faculty members, 10 exam slots over 3 days, assign duties based on seniority").

9. FOR ALL valid inputs, running the solver twice on the same inputs with the same rules SHALL produce an equivalent assignment (determinism property).

10. THE Platform SHALL retain all generated assignments as Records in the Live Grid, making them searchable, filterable, auditable, and exportable like any other data.

