// @ts-check

/**
 * @typedef {'admin'|'member'} OrgRole
 * @typedef {'admin'|'employee'} AppRole
 * @typedef {'editor'|'viewer'} DeckCollaboratorRole
 * @typedef {'view'|'edit'} SharePermission
 * @typedef {'draft'|'active'|'published'|'archived'} DeckStatus
 */

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} email
 * @property {string} name
 * @property {AppRole} role
 * @property {'invited'|'active'|'disabled'} status
 */

/**
 * @typedef {object} Deck
 * @property {string} id
 * @property {string} org_id
 * @property {string} owner_user_id
 * @property {string} title
 * @property {DeckStatus} status
 * @property {string} fs_path
 * @property {string} subdomain
 * @property {string | null} published_build_path
 * @property {string | null} active_editor_user_id
 */

/**
 * @typedef {object} AgentEvent
 * @property {'message'|'tool'|'file_change'|'run_status'|'error'} type
 * @property {unknown} payload
 */

export {};

