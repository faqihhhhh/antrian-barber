package account

import (
	"reflect"
	"testing"
)

func TestWorkspaceRolesAlwaysKeepsOwner(t *testing.T) {
	cases := []struct {
		name    string
		admin   bool
		kapster bool
		want    []string
	}{
		{name: "owner saja", want: []string{"owner"}},
		{name: "admin", admin: true, want: []string{"owner", "admin"}},
		{name: "kapster", kapster: true, want: []string{"owner", "kapster"}},
		{name: "admin dan kapster", admin: true, kapster: true, want: []string{"owner", "admin", "kapster"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := workspaceRoles(tc.admin, tc.kapster); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("workspaceRoles(%t, %t) = %v, want %v", tc.admin, tc.kapster, got, tc.want)
			}
		})
	}
}
