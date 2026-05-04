-- Add AI auto-analysis columns to applications table
-- applicant_type_score: AI confidence score 0-100
-- auto_analysis_type: AI classification ('general' or 'promotion')

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS applicant_type_score INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_analysis_type TEXT DEFAULT NULL;

-- Add check constraint for applicant_type_score range
ALTER TABLE applications
  ADD CONSTRAINT chk_applicant_type_score
  CHECK (applicant_type_score IS NULL OR (applicant_type_score >= 0 AND applicant_type_score <= 100));

-- Add check constraint for auto_analysis_type values
ALTER TABLE applications
  ADD CONSTRAINT chk_auto_analysis_type
  CHECK (auto_analysis_type IS NULL OR auto_analysis_type IN ('general', 'promotion'));

COMMENT ON COLUMN applications.applicant_type_score IS 'AI confidence score (0-100) for applicant type classification';
COMMENT ON COLUMN applications.auto_analysis_type IS 'AI auto-analysis type: general or promotion';
