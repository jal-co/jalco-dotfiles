local function changed()
  print('{"type":"changed"}')
end
rex.on("session_created", changed)
rex.on("session_destroyed", changed)
rex.on("session_moved", changed)
local attached, err = rex.call("session.attach_all", { event_scope = "session" })
if not attached then error(err, 0) end
print('{"type":"ready"}')
