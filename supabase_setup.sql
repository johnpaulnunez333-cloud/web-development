CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE messages;

CREATE POLICY "Allow all" ON messages FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;