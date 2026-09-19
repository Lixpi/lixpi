export type SubjectPermissions = {
    pub?: { allow: readonly string[] }
    sub?: { allow: readonly string[] }
}

export type ServicePermissions = {
    pub: { allow: string[] }
    sub: { allow: string[] }
}

export type EndpointContract = {
    id: string
    subject: string
    type: 'reply' | 'subscribe'
    payloadType: 'json' | 'buffer'
    queue?: string
    permissions: SubjectPermissions | 'none'
}
