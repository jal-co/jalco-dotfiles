return function(options)
  assert(type(options.node) == "string", "Provide the Node executable")
  assert(type(options.script) == "string", "Provide the session-pins.mjs path")
  for _, operation in ipairs({ "pin", "unpin" }) do
    local action = operation
    rex.action{
      name = "rex_plugins_" .. action .. "_session",
      title = action == "pin" and "Pin Session" or "Unpin Session",
      category = "Session",
      args = {},
      run = function(ctx)
        if not ctx.session_id then error("Select a session first", 0) end
        local result, err = rex.exec({ options.node, options.script, action, ctx.session_id }, { timeout = 15 })
        if not result then error(err, 0) end
        if not result.ok then error(result.stderr, 0) end
        local value, decode_error = rex.json.decode(result.stdout)
        if not value then error(decode_error, 0) end
        return value
      end,
    }
  end
end
