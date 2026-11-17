-- Ensure exam seat inserts can generate their integer primary key.
create sequence if not exists public.exam_seats_id_seq;
select setval('public.exam_seats_id_seq', coalesce((select max(id) from public.exam_seats), 0) + 1, false);
alter table public.exam_seats alter column id set default nextval('public.exam_seats_id_seq');
alter sequence public.exam_seats_id_seq owned by public.exam_seats.id;
