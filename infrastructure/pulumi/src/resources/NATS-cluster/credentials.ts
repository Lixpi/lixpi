import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

export const createNatsCredentialSecret = (
    name: string,
    value: string | undefined,
): pulumi.Output<string> => {
    if (!value)
        throw new Error(`Missing NATS credential: ${name}`)

    const secret = new aws.secretsmanager.Secret(name, {})
    const version = new aws.secretsmanager.SecretVersion(
        `${name}-value`,
        {
            secretId: secret.id,
            secretString: pulumi.secret(value),
        },
    )

    return pulumi.all([secret.arn, version.versionId]).apply(([arn]) => arn)
}

export const createNatsExecutionRole = (
    name: string,
    secretArns: pulumi.Input<string>[],
) => {
    const role = new aws.iam.Role(
        name,
        {
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: 'sts:AssumeRole',
                    Principal: { Service: 'ecs-tasks.amazonaws.com' },
                }],
            }),
        },
    )
    new aws.iam.RolePolicyAttachment(
        `${name}-ecs`,
        {
            role: role.name,
            policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
        },
    )
    new aws.iam.RolePolicy(
        `${name}-secrets`,
        {
            role: role.name,
            policy: pulumi.all(secretArns).apply(
                arns => JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [{
                        Effect: 'Allow',
                        Action: 'secretsmanager:GetSecretValue',
                        Resource: arns,
                    }],
                }),
            ),
        },
    )

    return role
}
