package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

func TestPrintJSON_Map(t *testing.T) {
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := printJSON(map[string]string{"key": "value"})

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("printJSON: %v", err)
	}

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	var result map[string]string
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v\noutput: %s", err, buf.String())
	}
	if result["key"] != "value" {
		t.Errorf("expected value %q, got %q", "value", result["key"])
	}
}

func TestPrintJSON_Slice(t *testing.T) {
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := printJSON([]int{1, 2, 3})

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("printJSON: %v", err)
	}

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	var result []int
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v\noutput: %s", err, buf.String())
	}
	if len(result) != 3 || result[0] != 1 {
		t.Errorf("expected [1,2,3], got %v", result)
	}
}

func TestPrintJSON_Struct(t *testing.T) {
	type testStruct struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := printJSON(testStruct{Name: "test", Count: 42})

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("printJSON: %v", err)
	}

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	var result testStruct
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v\noutput: %s", err, buf.String())
	}
	if result.Name != "test" || result.Count != 42 {
		t.Errorf("expected {test 42}, got %+v", result)
	}
}

func TestPrintJSON_Nil(t *testing.T) {
	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err := printJSON(nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("printJSON nil: %v", err)
	}
}
