import { PRECONDITION_INVALID, PRECONDITION_REQUIRED } from '@liquid-bricks/lib-diagnostics/codes'

export function validatePayload({ scope: { directories }, rootCtx: { diagnostics } }) {
  diagnostics.require(Array.isArray(directories), PRECONDITION_INVALID, 'directories must be an array', { field: 'directories' })
  diagnostics.require(directories.length > 0, PRECONDITION_REQUIRED, 'directories is required', { field: 'directories' })
}
