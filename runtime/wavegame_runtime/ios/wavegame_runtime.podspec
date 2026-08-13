Pod::Spec.new do |s|
  s.name             = 'wavegame_runtime'
  s.version          = '0.1.0'
  s.summary          = 'Sandboxed native runtime for WaveGames cartridges.'
  s.description      = 'Document import and isolated WKWebView execution for WaveGames cartridges.'
  s.homepage         = 'https://github.com/AllenT22/WaveGames'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'WaveGames contributors' => 'opensource@invalid.example' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.frameworks       = 'UniformTypeIdentifiers', 'WebKit'
  s.platform         = :ios, '17.0'
  s.swift_version    = '5.0'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386'
  }
end
