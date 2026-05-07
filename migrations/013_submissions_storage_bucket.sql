-- =====================================================
-- 013_submissions_storage_bucket.sql
-- Description: Create submissions bucket and RLS policies
-- =====================================================

-- Create submissions bucket (public read, authenticated upload)
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES (
  'submissions',
  'submissions',
  true,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ],
  10485760  -- 10MB
)
ON CONFLICT (id) DO UPDATE SET
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit;

-- RLS policy: anyone can read
DROP POLICY IF EXISTS "submissions_public_read" ON storage.objects;
CREATE POLICY "submissions_public_read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'submissions');

-- RLS policy: authenticated users can upload
DROP POLICY IF EXISTS "submissions_authenticated_upload" ON storage.objects;
CREATE POLICY "submissions_authenticated_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'submissions');
