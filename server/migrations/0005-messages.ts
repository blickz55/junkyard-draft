// Direct messages (production roadmap 0.11.9). A removed message keeps its row and its words, so an appeal can undo it; a report
// holds what the classifier made of the reported words, because messages are read only once someone reports one.
export const up = `
ALTER TABLE messages ADD COLUMN removed_at INTEGER;
ALTER TABLE messages ADD COLUMN reason_code TEXT;
ALTER TABLE reports ADD COLUMN triage_category TEXT;
ALTER TABLE reports ADD COLUMN triage_score REAL;
`;

export const down = `
ALTER TABLE reports DROP COLUMN triage_score;
ALTER TABLE reports DROP COLUMN triage_category;
ALTER TABLE messages DROP COLUMN reason_code;
ALTER TABLE messages DROP COLUMN removed_at;
`;
