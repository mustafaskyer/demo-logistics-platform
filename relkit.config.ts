/** Declares backend defaults; inspection remains disabled unless explicitly enabled. */
import env from '@app/platform/env.js'
import { localEvent, localRealtime } from '@relkit/local'
import { s3 } from '@relkit/s3'
import { env as binding, defineApp } from 'relkit/config'

export default defineApp({
  id: 'relkit-logistics-14-nov',
  env,
  telemetry: { redaction: { mode: 'development-redacted', maxBytes: 65_536 } },
  server: { port: 4100, maxBodyBytes: 1_048_576, apiDocs: { ui: 'scalar' } },
  event: { local: localEvent() },
  realtime: localRealtime(),
  defaults: { event: 'local', bucket: 'local', realtime: 'default' },
  bucket: {
    local: s3({
      bucketName: 'zsys',
      credentials: {
        accessKeyId: binding.secret('ACCESS_KEY_ID'),
        secretAccessKey: binding.secret('SECRET_ACCESS_ID'),
      },
      region: 'default',
      endpoint: binding.url('BUCKET_ENDPOINT'),
    }),
  },
  inspector: { enabled: true },
})
