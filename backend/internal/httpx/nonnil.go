package httpx

// NonNil mengubah slice nil menjadi slice kosong (bukan nil), supaya
// json.Marshal menghasilkan "[]" alih-alih "null" saat hasilnya kosong.
// Pakai ini di setiap service yang mengembalikan daftar (List...).
func NonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}