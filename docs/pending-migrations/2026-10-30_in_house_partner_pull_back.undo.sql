-- Removes only this action. Assignment and workflow history are permanent; bookings untouched.
DROP FUNCTION IF EXISTS public.pull_back_in_house_job(uuid,text,uuid);