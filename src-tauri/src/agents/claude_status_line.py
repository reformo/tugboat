import json, sys

# Tugboat passes this script to Claude Code as the status line command.
# Claude Code writes the session state as JSON on stdin. Absent fields are skipped.
try:
    data = json.load(sys.stdin)
except ValueError:
    sys.exit(0)


def value(*keys):
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def number(item):
    return isinstance(item, (int, float)) and not isinstance(item, bool)


def tokens(count):
    if count >= 1000000:
        return "%.1fM" % (count / 1000000)
    if count >= 1000:
        return "%.1fk" % (count / 1000)
    return "%d" % count


parts = []
model = value("model", "display_name") or value("model", "id")
if model:
    parts.append(str(model))
effort = value("effort", "level")
if effort:
    parts.append("effort " + str(effort))
received = value("context_window", "total_input_tokens")
if number(received):
    parts.append("in " + tokens(received))
sent = value("context_window", "total_output_tokens")
if number(sent):
    parts.append("out " + tokens(sent))
context = value("context_window", "remaining_percentage")
if number(context):
    parts.append("context %.0f%% left" % context)
for window, label in (("five_hour", "5h"), ("seven_day", "7d")):
    used = value("rate_limits", window, "used_percentage")
    if number(used):
        parts.append("%s %.0f%% left" % (label, max(0, 100 - used)))
print(" | ".join(parts))
