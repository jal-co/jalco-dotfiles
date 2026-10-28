rex.action{
  name = "task_overview",
  title = "Task Overview",
  category = "Session",
  description = "Open the live, read-only Rex task overview",
  keywords = "agents tasks status recovery overview",
  args = {},
  run = function()
    local home = assert(os.getenv("HOME"), "HOME is not set")
    local result, err = rex.exec({ home .. "/.local/share/mise/shims/node", home .. "/dotfiles/rex/src/overview-launcher.mjs" }, { timeout = 20 })
    if not result then error(err, 0) end
    if not result.ok then error(result.stderr, 0) end
    local view, decode_error = rex.json.decode(result.stdout)
    if not view then error(decode_error, 0) end
    rex.client.queue("session.select", { session_id = view.session_id })
    return view
  end,
}
