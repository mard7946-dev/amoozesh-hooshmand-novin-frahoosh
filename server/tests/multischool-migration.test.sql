-- Runs after the experimental expand migration on a disposable PostgreSQL database.
-- All fixture writes are rolled back.
BEGIN;

DO $$
DECLARE
  school_a UUID := '5c8b8880-1346-445c-89d8-3f76275a7ae5';
  school_b UUID := 'b7b8c9d0-1111-4222-8333-444455556666';
  manager_a BIGINT;
  teacher_a BIGINT;
  teacher_b BIGINT;
  student_a BIGINT;
  room_a UUID;
  room_b UUID;
BEGIN
  INSERT INTO school_tenants(id,slug,display_name)
  VALUES (school_b,'rehearsal-school-b','Rehearsal School B')
  ON CONFLICT (id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM classroom_users WHERE school_id IS NULL)
     OR EXISTS (SELECT 1 FROM classrooms WHERE school_id IS NULL)
     OR EXISTS (SELECT 1 FROM school_schedule WHERE school_id IS NULL)
     OR EXISTS (SELECT 1 FROM classroom_sessions WHERE school_id IS NULL)
     OR EXISTS (SELECT 1 FROM classroom_memberships WHERE school_id IS NULL)
     OR EXISTS (SELECT 1 FROM classroom_events WHERE school_id IS NULL) THEN
    RAISE EXCEPTION 'Tenant backfill left NULL school_id values';
  END IF;

  IF EXISTS (SELECT 1 FROM classroom_users WHERE school_id <> school_a) THEN
    RAISE EXCEPTION 'Legacy users were not assigned to the confirmed school';
  END IF;

  INSERT INTO classroom_users(role,display_name,username,school_id)
  VALUES ('manager','A Manager','same-login',school_a)
  RETURNING id INTO manager_a;

  INSERT INTO classroom_users(role,display_name,username,school_id)
  VALUES ('teacher','A Teacher','same-teacher',school_a)
  RETURNING id INTO teacher_a;

  INSERT INTO classroom_users(role,display_name,username,school_id)
  VALUES ('teacher','B Teacher','same-teacher',school_b)
  RETURNING id INTO teacher_b;

  INSERT INTO classroom_users(role,display_name,username,school_id)
  VALUES ('student','A Student','same-student',school_a)
  RETURNING id INTO student_a;

  INSERT INTO classrooms(title,grade_class,teacher_user_id,room_code,created_by,school_id)
  VALUES ('A room','Grade 7 / A',teacher_a,'SHARED-CODE',manager_a,school_a)
  RETURNING id INTO room_a;

  INSERT INTO classroom_users(role,display_name,username,school_id)
  VALUES ('manager','B Manager','same-manager',school_b)
  RETURNING id INTO manager_a;

  INSERT INTO classrooms(title,grade_class,teacher_user_id,room_code,created_by,school_id)
  VALUES ('B room','Grade 7 / A',teacher_b,'SHARED-CODE',manager_a,school_b)
  RETURNING id INTO room_b;

  INSERT INTO school_schedule(day_of_week,period,grade_class,teacher_user_id,classroom_id,school_id)
  VALUES ('sunday',1,'Grade 7 / A',teacher_a,room_a,school_a),
         ('sunday',1,'Grade 7 / A',teacher_b,room_b,school_b);

  INSERT INTO classroom_memberships(classroom_id,student_user_id,school_id)
  VALUES (room_a,student_a,school_a);

  IF (SELECT count(*) FROM classroom_users WHERE username='same-teacher') <> 2 THEN
    RAISE EXCEPTION 'Same username should be permitted in separate schools';
  END IF;
  IF (SELECT count(*) FROM classrooms WHERE room_code='SHARED-CODE') <> 2 THEN
    RAISE EXCEPTION 'Same room code should be permitted in separate schools';
  END IF;
  IF (SELECT count(*) FROM school_schedule WHERE day_of_week='sunday' AND period=1 AND grade_class='Grade 7 / A') <> 2 THEN
    RAISE EXCEPTION 'Same schedule slot should be permitted in separate schools';
  END IF;

  BEGIN
    INSERT INTO classrooms(title,grade_class,teacher_user_id,room_code,created_by,school_id)
    VALUES ('Cross-tenant invalid room','Grade 7 / A',teacher_b,'BAD-CROSS-TENANT',manager_a,school_a);
    RAISE EXCEPTION 'Cross-tenant teacher reference unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO classroom_memberships(classroom_id,student_user_id,school_id)
    VALUES (room_a, (SELECT id FROM classroom_users WHERE username='same-teacher' AND school_id=school_b), school_a);
    RAISE EXCEPTION 'Cross-tenant membership unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO classroom_sessions(token_hash,user_id,expires_at,school_id)
    VALUES ('cross-tenant-session-test', teacher_b, now()+interval '1 hour', school_a);
    RAISE EXCEPTION 'Cross-tenant session unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO classroom_events(classroom_id,actor_user_id,event_type,school_id)
    VALUES (room_a, teacher_b, 'cross-tenant-event-test', school_a);
    RAISE EXCEPTION 'Cross-tenant event unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO school_schedule(day_of_week,period,grade_class,teacher_user_id,classroom_id,school_id)
    VALUES ('monday',2,'Grade 7 / A',teacher_b,room_a,school_a);
    RAISE EXCEPTION 'Cross-tenant schedule references unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  RAISE NOTICE 'Multischool migration rehearsal assertions passed';
END $$;

ROLLBACK;
