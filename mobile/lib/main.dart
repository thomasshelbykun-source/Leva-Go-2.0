// LevaGo para Android: abre o site oficial (Cliente, Estafeta e Admin) num ecrã próprio,
// com as cores da marca, mapa com localização, envio de documentos e ecrã sem rede.
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

const navy = Color(0xFF0D2A4F);
const orange = Color(0xFFF26A12);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: navy,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Colors.white,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  runApp(const LevaGoApp());
}

class LevaGoApp extends StatelessWidget {
  const LevaGoApp({super.key});

  /// Site publicado. Cliente, Estafeta e Admin estão no mesmo endereço.
  static const siteUrl = 'https://levago-three.vercel.app/';
  static const ownHosts = {'levago-three.vercel.app', 'levago-api.vercel.app'};

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LevaGo',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: orange, primary: orange, secondary: navy),
        useMaterial3: true,
      ),
      home: const SiteScreen(),
    );
  }
}

class SiteScreen extends StatefulWidget {
  const SiteScreen({super.key});

  @override
  State<SiteScreen> createState() => _SiteScreenState();
}

class _SiteScreenState extends State<SiteScreen> {
  late final WebViewController _web;
  bool _loading = true;
  bool _offline = false;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) => setState(() => _progress = p),
        onPageStarted: (_) => setState(() {
          _loading = true;
          _offline = false;
        }),
        onPageFinished: (_) => setState(() => _loading = false),
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) setState(() => _offline = true);
        },
        onNavigationRequest: (req) {
          final uri = Uri.tryParse(req.url);
          if (uri == null) return NavigationDecision.prevent;
          final inside = (uri.scheme == 'https' || uri.scheme == 'http') && LevaGoApp.ownHosts.contains(uri.host);
          if (inside) return NavigationDecision.navigate;
          // Telefone, WhatsApp, mapas e outros sites abrem fora da app.
          launchUrl(uri, mode: LaunchMode.externalApplication);
          return NavigationDecision.prevent;
        },
      ));

    final platform = _web.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(true);
      platform.setOnShowFileSelector(_pickFiles);
      platform.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (request) async {
          final status = await Permission.locationWhenInUse.request();
          return GeolocationPermissionsResponse(allow: status.isGranted, retain: status.isGranted);
        },
      );
    }
    _web.loadRequest(Uri.parse(LevaGoApp.siteUrl));
  }

  /// Documentos do estafeta e fotos: o site pede um ficheiro, a app abre o seletor do telemóvel.
  Future<List<String>> _pickFiles(FileSelectorParams params) async {
    final onlyImages = params.acceptTypes.isNotEmpty && params.acceptTypes.every((t) => t.startsWith('image/'));
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: params.mode == FileSelectorMode.openMultiple,
      type: onlyImages ? FileType.image : FileType.any,
    );
    if (result == null) return [];
    return result.files.where((f) => f.path != null).map((f) => Uri.file(f.path!).toString()).toList();
  }

  Future<void> _back() async {
    if (await _web.canGoBack()) {
      await _web.goBack();
    } else {
      await SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: navy,
        body: SafeArea(
          child: Stack(
            children: [
              Positioned.fill(child: Container(color: Colors.white, child: WebViewWidget(controller: _web))),
              if (_loading && _progress < 100)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: LinearProgressIndicator(
                    value: _progress == 0 ? null : _progress / 100,
                    minHeight: 3,
                    color: orange,
                    backgroundColor: navy.withValues(alpha: 0.15),
                  ),
                ),
              if (_offline) Positioned.fill(child: _OfflineView(onRetry: () => _web.reload())),
            ],
          ),
        ),
      ),
    );
  }
}

class _OfflineView extends StatelessWidget {
  const _OfflineView({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: navy,
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Image.asset('assets/icon-foreground.png', width: 140),
          const SizedBox(height: 8),
          const Text.rich(
            TextSpan(children: [
              TextSpan(text: 'Leva', style: TextStyle(color: Colors.white)),
              TextSpan(text: 'Go', style: TextStyle(color: orange)),
            ]),
            style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, fontStyle: FontStyle.italic),
          ),
          const SizedBox(height: 24),
          const Text(
            'Sem ligação à internet.',
            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          const Text(
            'Verifica os dados móveis ou o Wi-Fi e tenta de novo.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFFC7D3E6)),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: orange, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
              onPressed: onRetry,
              child: const Text('Tentar de novo', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
          ),
        ],
      ),
    );
  }
}
