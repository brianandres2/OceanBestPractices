import { Vpc } from '@aws-cdk/aws-ec2';
import {
  Construct,
  Stack,
  StackProps,
} from '@aws-cdk/core';
import { Function } from '@aws-cdk/aws-lambda';
import OpenSearch from './opensearch';
import Ingest from './ingest';
import Neptune from './neptune';
import Website from './website';
import Api from './api';
import Bastion from './bastion';

type ObpStackProps = Omit<StackProps, 'env' | 'stackName'>
  & {
    env: Required<StackProps['env']>,
    stackName: StackProps['stackName'],
    disableWebsiteCache?: boolean
    deletionProtection?: boolean
    searchNodeType?: string
  };

export default class ObpStack extends Stack {
  constructor(scope: Construct, id: string, props: ObpStackProps) {
    const {
      disableWebsiteCache = false,
      deletionProtection = true,
      searchNodeType,
      ...superProps
    } = props;

    super(scope, id, {
      terminationProtection: deletionProtection,
      ...superProps,
    });

    const vpc = Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    const bastion = new Bastion(this, 'Bastion', {
      stackName: this.stackName,
      deletionProtection,
      vpc,
    });

    const neptune = new Neptune(this, 'Neptune', {
      deletionProtection,
      stackName: this.stackName,
      allowFrom: [bastion.instance],
      vpc,
    });

    const openSearch = new OpenSearch(this, 'Elasticsearch', {
      deletionProtection,
      stackName: this.stackName,
      searchNodeType,
      allowFromIps: [
        bastion.privateIp,
        bastion.publicIp,
      ],
    });

    const website = new Website(this, 'Website', {
      deletionProtection,
      stackName: this.stackName,
      disableWebsiteCache,
    });

    const textExtractorFunction = Function.fromFunctionArn(
      this,
      'TextExtractor',
      `arn:aws:lambda:${this.region}:${this.account}:function:textractor_simple`
    );

    new Ingest(this, 'Ingest', {
      openSearch: openSearch.domain,
      stackName: this.stackName,
      textExtractorFunction,
      websiteDistribution: website.cloudfrontDistribution,
    });

    new Api(this, 'Api', {
      stackName: this.stackName,
      region: this.region,
      graphDbHostname: neptune.cluster.clusterEndpoint.hostname,
      graphDbPort: neptune.cluster.clusterEndpoint.port,
      openSearch: openSearch.domain,
      websiteDistribution: website.cloudfrontDistribution,
    });
  }
}