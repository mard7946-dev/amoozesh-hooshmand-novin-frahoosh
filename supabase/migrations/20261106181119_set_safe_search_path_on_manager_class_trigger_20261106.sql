-- This trigger function references its helper with an explicit schema.
-- Pin an empty search_path to prevent object-shadowing through mutable lookup paths.
alter function public.enforce_manager_online_class_duration() set search_path = '';
