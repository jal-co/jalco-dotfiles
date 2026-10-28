if rex.args and rex.args.watch then
  local function changed()
    print('{"type":"changed"}')
  end
  rex.on("session_created", changed)
  rex.on("session_destroyed", changed)
  rex.on("session_moved", changed)
  local attached, err = rex.call("session.attach_all", { event_scope = "session" })
  if not attached then error(err, 0) end
  print('{"type":"ready"}')
else
  local home = assert(os.getenv("HOME"), "HOME is not set")
  local node = home .. "/.local/share/mise/shims/node"
  local script = home .. "/dotfiles/rex/plugins/session-pins/session-pins.mjs"
  for _, operation in ipairs({ "pin", "unpin" }) do
    local action = operation
    rex.action{
      name = action .. "_session",
      title = action == "pin" and "Pin Session" or "Unpin Session",
      category = "Session",
      description = action == "pin" and "Keep this session above unpinned sessions" or "Allow this session to be reordered normally",
      keywords = "session pin unpin sidebar top",
      args = {},
      run = function(ctx)
        if not ctx.session_id then error("Select a session first", 0) end
        local result, err = rex.exec({ node, script, action, ctx.session_id }, { timeout = 15 })
        if not result then error(err, 0) end
        if not result.ok then error(result.stderr, 0) end
        local value, decode_error = rex.json.decode(result.stdout)
        if not value then error(decode_error, 0) end
        return value
      end,
    }
  end
end
