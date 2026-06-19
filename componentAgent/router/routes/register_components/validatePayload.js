import { Codes } from '../../../codes.js'

export function validatePayload({ scope: { directories }, rootCtx: { diagnostics } }) {
  diagnostics.require(Array.isArray(directories), Codes.PRECONDITION_INVALID, 'directories must be an array', { field: 'directories' })
  diagnostics.require(directories.length > 0, Codes.PRECONDITION_REQUIRED, 'directories is required', { field: 'directories' })
}
