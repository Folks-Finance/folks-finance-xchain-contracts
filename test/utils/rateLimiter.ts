export interface BucketConfig {
  period: bigint;
  offset: bigint;
  limit: bigint;
  minBucketLimit?: bigint;
}
