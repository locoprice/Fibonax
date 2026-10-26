-- UNDO for 20261026150000_ai_call_limit.sql
--
-- Removes the AI call limit. Run it only after the AI edge functions are back
-- on a version that does not call ai_call_allow(): the current ones answer 503
-- while the function is missing, so Draft with AI and Ask Fibonax stop working.
--
-- Drops the function and the table of call times. The table holds at most a day
-- of timestamps (who, which feature, when), nothing anyone wrote.

drop function if exists public.ai_call_allow(text);
drop table if exists app.ai_calls;
