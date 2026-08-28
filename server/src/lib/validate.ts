import { zValidator } from '@hono/zod-validator'
import type { ZodSchema } from 'zod'

export function validate<T extends ZodSchema>(target: 'json' | 'query', schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
      return c.json({ error: { code: 'validation', message } }, 422)
    }
  })
}
