-- 004_create_student.sql
-- Student profile extension of user_account, scoped to a single institution.

CREATE TABLE student (
  student_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE REFERENCES user_account(user_id) ON DELETE RESTRICT,
  institution_id     UUID NOT NULL REFERENCES institution(institution_id) ON DELETE RESTRICT,
  enrollment_number  TEXT,
  course             TEXT,
  graduation_year    INTEGER CHECK (graduation_year BETWEEN 1900 AND 2200)
);
