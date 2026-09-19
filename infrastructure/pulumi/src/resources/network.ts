import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import { formatStageResourceName } from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE,
} = process.env

export const createNetworkInfrastructure = async () => {
    // Validate AWS region explicitly
    const awsRegion = aws.config.region

    if (!awsRegion)
        throw new Error('AWS Region configuration is missing. Please set AWS region properly.')

    // Three JetStream replicas need independent Availability Zones.
    const azs = await aws.getAvailabilityZones()

    if (azs.names.length < 3)
        throw new Error('NATS requires at least three Availability Zones')

    const vpcName = formatStageResourceName(
        'VPC',
        ORG_NAME,
        STAGE,
    )

    // Create VPC (always provisioned)
    const vpc = new aws.ec2.Vpc(
        vpcName,
        {
            cidrBlock: '10.0.0.0/16',
            enableDnsHostnames: true,
            enableDnsSupport: true,
            tags: { Name: vpcName },
        },
    )

    // Internet Gateway
    const igw = new aws.ec2.InternetGateway(
        formatStageResourceName(
            'Internet-Gateway',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            tags: { Name: formatStageResourceName(
                'Internet-Gateway',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    // Public Subnets
    const publicSubnetAZ1 = new aws.ec2.Subnet(
        formatStageResourceName(
            'Public-Subnet-1',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            cidrBlock: '10.0.0.0/24',
            availabilityZone: azs.names[0],
            mapPublicIpOnLaunch: true,
            tags: { Name: formatStageResourceName(
                'Public-Subnet-1',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    const publicSubnetAZ2 = new aws.ec2.Subnet(
        formatStageResourceName(
            'Public-Subnet-2',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            cidrBlock: '10.0.1.0/24',
            availabilityZone: azs.names[1],
            mapPublicIpOnLaunch: true,
            tags: { Name: formatStageResourceName(
                'Public-Subnet-2',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    // Private Subnets
    const privateSubnetAZ1 = new aws.ec2.Subnet(
        formatStageResourceName(
            'Private-Subnet-1',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            cidrBlock: '10.0.2.0/24',
            availabilityZone: azs.names[0],
            mapPublicIpOnLaunch: false,
            tags: { Name: formatStageResourceName(
                'Private-Subnet-1',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    const privateSubnetAZ2 = new aws.ec2.Subnet(
        formatStageResourceName(
            'Private-Subnet-2',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            cidrBlock: '10.0.3.0/24',
            availabilityZone: azs.names[1],
            mapPublicIpOnLaunch: false,
            tags: { Name: formatStageResourceName(
                'Private-Subnet-2',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    // Preserve existing subnet addresses when adding the third zone.
    const publicSubnetAZ3 = new aws.ec2.Subnet(
        formatStageResourceName(
            'Public-Subnet-3',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            cidrBlock: '10.0.4.0/24',
            availabilityZone: azs.names[2],
            mapPublicIpOnLaunch: true,
        },
    )
    const privateSubnetAZ3 = new aws.ec2.Subnet(
        formatStageResourceName(
            'Private-Subnet-3',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            cidrBlock: '10.0.5.0/24',
            availabilityZone: azs.names[2],
            mapPublicIpOnLaunch: false,
        },
    )

    // Public Route Table
    const publicRouteTable = new aws.ec2.RouteTable(
        formatStageResourceName(
            'Public-Route-Table',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            tags: { Name: formatStageResourceName(
                'Public-Route-Table',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    new aws.ec2.Route(
        formatStageResourceName(
            'Public-Route',
            ORG_NAME,
            STAGE,
        ),
        {
            routeTableId: publicRouteTable.id,
            destinationCidrBlock: '0.0.0.0/0',
            gatewayId: igw.id,
        },
    )

    new aws.ec2.RouteTableAssociation(
        formatStageResourceName(
            'Public-Subnet-Assoc-1',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: publicSubnetAZ1.id,
            routeTableId: publicRouteTable.id,
        },
    )

    new aws.ec2.RouteTableAssociation(
        formatStageResourceName(
            'Public-Subnet-Assoc-2',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: publicSubnetAZ2.id,
            routeTableId: publicRouteTable.id,
        },
    )

    // NAT Gateway & Elastic IP
    const natEip = new aws.ec2.Eip(
        formatStageResourceName(
            'NAT-EIP',
            ORG_NAME,
            STAGE,
        ),
        {
            domain: 'vpc',
            tags: { Name: formatStageResourceName(
                'NAT-EIP',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    const natGateway = new aws.ec2.NatGateway(
        formatStageResourceName(
            'NAT-Gateway',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: publicSubnetAZ1.id,
            allocationId: natEip.id,
            tags: { Name: formatStageResourceName(
                'NAT-Gateway',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    // Private Route Table
    const privateRouteTable = new aws.ec2.RouteTable(
        formatStageResourceName(
            'Private-Route-Table',
            ORG_NAME,
            STAGE,
        ),
        {
            vpcId: vpc.id,
            tags: { Name: formatStageResourceName(
                'Private-Route-Table',
                ORG_NAME,
                STAGE,
            ) },
        },
    )

    new aws.ec2.Route(
        formatStageResourceName(
            'Private-Route',
            ORG_NAME,
            STAGE,
        ),
        {
            routeTableId: privateRouteTable.id,
            destinationCidrBlock: '0.0.0.0/0',
            natGatewayId: natGateway.id,
        },
    )

    new aws.ec2.RouteTableAssociation(
        formatStageResourceName(
            'Private-Subnet-Assoc-1',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: privateSubnetAZ1.id,
            routeTableId: privateRouteTable.id,
        },
    )

    new aws.ec2.RouteTableAssociation(
        formatStageResourceName(
            'Private-Subnet-Assoc-2',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: privateSubnetAZ2.id,
            routeTableId: privateRouteTable.id,
        },
    )

    new aws.ec2.RouteTableAssociation(
        formatStageResourceName(
            'Public-Subnet-Assoc-3',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: publicSubnetAZ3.id,
            routeTableId: publicRouteTable.id,
        },
    )
    new aws.ec2.RouteTableAssociation(
        formatStageResourceName(
            'Private-Subnet-Assoc-3',
            ORG_NAME,
            STAGE,
        ),
        {
            subnetId: privateSubnetAZ3.id,
            routeTableId: privateRouteTable.id,
        },
    )

    // Outputs
    const outputs: Record<string, pulumi.Output<any>> = {
        vpcId: vpc.id,
        vpcName: pulumi.output(vpcName),
        publicSubnetIds: pulumi.all([publicSubnetAZ1.id, publicSubnetAZ2.id, publicSubnetAZ3.id]),
        privateSubnetIds: pulumi.all([privateSubnetAZ1.id, privateSubnetAZ2.id, privateSubnetAZ3.id]),
        natGatewayIp: natEip.publicIp,
    }

    return {
        vpc,
        publicSubnets: [
            publicSubnetAZ1,
            publicSubnetAZ2,
            publicSubnetAZ3,
        ],
        privateSubnets: [
            privateSubnetAZ1,
            privateSubnetAZ2,
            privateSubnetAZ3,
        ],
        internetGateway: igw,
        natGateway,
        natEip,
        outputs,
    }
}
