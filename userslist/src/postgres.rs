use crate::error::AppError;
use sqlx::PgPool;

pub async fn init_db(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS campaigns (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL,
            campaign_creator_address TEXT NOT NULL,
            merkle_root TEXT NOT NULL,
            leaf_count INTEGER NOT NULL,
            depth INTEGER NOT NULL,
            hash_algorithm TEXT NOT NULL,
            leaf_encoding TEXT NOT NULL,
            filecoin_cid TEXT,
            filecoin_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS filecoin_cid TEXT
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS filecoin_url TEXT
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS campaign_claims (
            id BIGSERIAL PRIMARY KEY,
            campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
            leaf_address TEXT NOT NULL,
            amount TEXT NOT NULL,
            leaf_index INTEGER NOT NULL,
            leaf_hash TEXT NOT NULL,
            proof JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (campaign_id, leaf_address),
            UNIQUE (campaign_id, leaf_index)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS campaigns_creator_idx
        ON campaigns (campaign_creator_address, created_at DESC)
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS campaign_claims_lookup_idx
        ON campaign_claims (campaign_id, leaf_address)
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
