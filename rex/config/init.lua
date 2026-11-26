require("session-pins")

if rex.match then
  rex.set("resume.trust.pi", {
    command = { "pi", "--session", rex.match.under("~/.pi/agent/sessions") },
  })
  rex.set("resume.trust.pi-coordinator", {
    command = { "pi", "--session", rex.match.under("~/.pi/agent/sessions"), "--approve" },
    dir = "~/rex-coord",
  })
end

-- >>> leaf >>>
-- Managed by `leaf rex install`; `leaf rex uninstall` removes it.
-- plugin: 04365960a540f318
local leaf = io.open("/Users/justin/.config/rex/plugins/leaf/init.lua")
if leaf then
  leaf:close()
  dofile("/Users/justin/.config/rex/plugins/leaf/init.lua").setup({ bin = { "/Users/justin/.local/bin/leaf" } })
end
-- open: idle classic
-- <<< leaf <<<
