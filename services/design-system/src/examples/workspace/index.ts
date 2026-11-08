import {
    type ExampleFrame,
} from '../example-frame.ts'
import {
    FullWorkspaceExample,
    DocumentNodesExample,
    ArtifactNodesExample,
    OperationNodesExample,
} from './canvas-examples.ts'
import {
    LibrariesExample,
    ConversationExample,
    ContextExample,
    ProgressReviewExample,
    RightPanelExample,
    GenerationHistoryExample,
} from './panel-examples.ts'
import { WorkspaceDiagramExample } from './diagram-example.ts'

export const mountWorkspaceExample = async (
    host: HTMLElement,
    id: string,
): Promise<{
    frame: ExampleFrame
    destroy: () => void
}> => {
    switch (id) {
        case 'workspace-canvas':
            return new FullWorkspaceExample(
                host,
                {
                    workspaceControls: false,
                    fitOnMount: true,
                },
            )
        case 'workspace-documents':
            return new DocumentNodesExample(host)
        case 'workspace-artifacts':
            return new ArtifactNodesExample(host)
        case 'workspace-operations':
            return new OperationNodesExample(host)
        case 'workspace-libraries':
            return new LibrariesExample(host)
        case 'workspace-conversation':
            return new ConversationExample(host)
        case 'workspace-history':
            return new GenerationHistoryExample(host)
        case 'workspace-context':
            return new ContextExample(host)
        case 'workspace-progress-review':
            return new ProgressReviewExample(host)
        case 'workspace-right-panel':
            return new RightPanelExample(host)
        case 'workspace-diagram':
            return new WorkspaceDiagramExample(host)
        default:
            throw new Error(`Unknown workspace example: ${id}`)
    }
}
