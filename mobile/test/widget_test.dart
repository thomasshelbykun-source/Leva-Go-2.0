import 'package:flutter_test/flutter_test.dart';
import 'package:levago/main.dart';

void main() {
  test('o endereço do site é HTTPS', () {
    expect(LevaGoApp.siteUrl.startsWith('https://'), isTrue);
  });
}
