import 'dart:convert';
import 'dart:io';

import 'package:speclink_dart_scanner/scanner.dart';

Future<void> main() async {
  final input = await utf8.decoder.bind(stdin).join();
  try {
    final output = Scanner().scan(input);
    stdout.write(output);
    stdout.write('\n');
  } catch (error) {
    stderr.write('speclink-dart-scanner: $error\n');
    exit(1);
  }
}
