create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create table public.schools (id uuid primary key);
insert into public.schools(id) values ('5c8b8880-1346-445c-89d8-3f76275a7ae5');
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
