import {
  Construct,
  Duration,
} from '@aws-cdk/core';
import * as events from '@aws-cdk/aws-events';
import * as eventTargets from '@aws-cdk/aws-events-targets';
import { LambdaSubscription } from '@aws-cdk/aws-sns-subscriptions';
import {
  LambdaDestination,
  SnsDestination,
} from '@aws-cdk/aws-s3-notifications';
import { IFunction } from '@aws-cdk/aws-lambda';
import { IDistribution } from '@aws-cdk/aws-cloudfront';
import { IDomain } from '@aws-cdk/aws-opensearchservice';
import IngestLambdas from './lambdas';
import IngestSnsTopics from './sns-topics';
import IngestBuckets from './buckets';

interface IngestProps {
  openSearch: IDomain
  stackName: string
  scheduleInterval?: number
  textExtractorFunction: IFunction
  websiteDistribution: IDistribution
}

export default class Ingest extends Construct {
  constructor(scope: Construct, id: string, props: IngestProps) {
    super(scope, id);

    const {
      openSearch,
      scheduleInterval = 300,
      stackName,
      textExtractorFunction,
      websiteDistribution,
    } = props;

    const buckets = new IngestBuckets(this, 'Buckets', {
      stackName,
      websiteDistribution,
    });

    const snsTopics = new IngestSnsTopics(this, 'SnsTopics', { stackName });

    const lambdas = new IngestLambdas(this, 'Lambdas', {
      buckets,
      elasticsearchDomain: openSearch,
      scheduleInterval,
      snsTopics,
      stackName,
      textExtractorFunction,
    });

    // Invoke the scheduler function every 5 minutes
    new events.Rule(this, 'SchedulerEventRule', {
      schedule: events.Schedule.rate(Duration.seconds(scheduleInterval)),
      targets: [new eventTargets.LambdaFunction(lambdas.scheduler)],
    });
    // Writes events to the "available document" topic

    // "metadata downloader" lambda is triggered by the
    // "available document" topic
    snsTopics.availableDocument.addSubscription(
      new LambdaSubscription(lambdas.metadataDownloader)
    );
    // "metadata downloader" lambda writes to the "document metadata" bucket

    // The "bitstreams downloader" lambda is triggered when an object is created
    // in the "document metadata" bucket
    buckets.documentMetadata.addObjectCreatedNotification(
      new LambdaDestination(lambdas.bitstreamsDownloader)
    );
    // The "bitstreams downloader" lambda writes an object to the
    // "document source" bucket

    // The "invoke extractor" lambda is triggered when an object is created in
    // the "document source" bucket
    buckets.documentSource.addObjectCreatedNotification(new LambdaDestination(
      lambdas.invokeExtractor
    ));

    buckets.textExtractorDestination.addObjectCreatedNotification(
      new SnsDestination(snsTopics.textExtractor)
    );
    // An event is published to the "text extractor" topic when an object is
    // created in the "text extractor destination" bucket

    // The "indexer" lambda is triggered by the "text extractor" topic
    snsTopics.textExtractor.addSubscription(
      new LambdaSubscription(lambdas.indexer)
    );
  }
}
