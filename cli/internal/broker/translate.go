package broker

import (
	"github.com/google/uuid"
)

// translateUserMessage converts a browser user message into the SDK format
// expected by Claude CLI.
//
//	Browser: {type:"user", content:"text"} or {type:"user", content:[blocks]}
//	SDK:     {type:"user", message:{role:"user", content:...}, parent_tool_use_id:null, session_id:"..."}
func translateUserMessage(content any, cliSessionID string) map[string]any {
	return map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": content,
		},
		"parent_tool_use_id": nil,
		"session_id":         cliSessionID,
	}
}

// translatePermissionResponse converts a browser permission_response into an
// SDK control_response.
//
//	Browser: {type:"permission_response", request_id, behavior, updated_input, updated_permissions}
//	SDK:     {type:"control_response", response:{subtype:"success", request_id, response:{behavior, ...}}}
func translatePermissionResponse(msg map[string]any) map[string]any {
	requestID, _ := msg["request_id"].(string)
	behavior, _ := msg["behavior"].(string)
	updatedInput, _ := msg["updated_input"]
	updatedPermissions, _ := msg["updated_permissions"]

	if updatedInput == nil {
		updatedInput = map[string]any{}
	}
	if updatedPermissions == nil {
		updatedPermissions = []any{}
	}

	return map[string]any{
		"subtype":    "success",
		"request_id": requestID,
		"response": map[string]any{
			"behavior":           behavior,
			"updatedInput":       updatedInput,
			"updatedPermissions": updatedPermissions,
		},
	}
}

// translateControlMessage converts browser control messages (interrupt,
// set_model, etc.) into SDK control_response format.
func translateControlMessage(msgType string, msg map[string]any) map[string]any {
	resp := map[string]any{
		"subtype":    msgType,
		"request_id": uuid.New().String(),
	}

	switch msgType {
	case "set_model":
		resp["model"], _ = msg["model"].(string)
	case "set_max_thinking_tokens":
		resp["max_thinking_tokens"] = msg["max_thinking_tokens"]
	case "set_permission_mode":
		resp["mode"], _ = msg["mode"].(string)
	case "mcp_set_servers":
		resp["servers"] = msg["servers"]
	}

	return resp
}

// filterCLIEvent returns true if the event should be forwarded to browsers.
// Drops keep_alive and content_block_delta with empty content.
func filterCLIEvent(data map[string]any) bool {
	msgType, _ := data["type"].(string)

	if msgType == "keep_alive" {
		return false
	}

	if msgType == "content_block_delta" {
		delta, ok := data["delta"].(map[string]any)
		if !ok {
			return false
		}
		text, _ := delta["text"].(string)
		thinking, _ := delta["thinking"].(string)
		partialJSON, _ := delta["partial_json"].(string)
		if text == "" && thinking == "" && partialJSON == "" {
			return false
		}
	}

	return true
}
