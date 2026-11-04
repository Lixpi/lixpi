import {
    CapabilityModuleCatalog,
    createMediaSequenceModule,
    type MediaRenderCompilerPort,
} from '@lixpi/capability-system/backend'
import { startMediaRenderWorkload } from './start-media-render-workload.ts'

const catalog = new CapabilityModuleCatalog()
catalog.registerModule(
    createMediaSequenceModule(),
)
const compiler = catalog.getExtension<MediaRenderCompilerPort>('media-sequence', 'renderCompiler')

if (!compiler)
    throw new Error('MEDIA_RENDER_COMPILER_UNAVAILABLE')

await startMediaRenderWorkload(compiler)
