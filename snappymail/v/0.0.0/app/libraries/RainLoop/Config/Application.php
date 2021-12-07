<?php

namespace RainLoop\Config;

class Application extends \RainLoop\Config\AbstractConfig
{
	private $aReplaceEnv = null;

	public function __construct()
	{
		parent::__construct('application.ini',
			'; SnappyMail configuration file
; Please don\'t add custom parameters here, those will be overwritten',
			defined('APP_ADDITIONAL_CONFIGURATION_NAME') ? APP_ADDITIONAL_CONFIGURATION_NAME : '');
	}

	public function Load() : bool
	{
		$bResult = parent::Load();

		$this->aReplaceEnv = null;
		if ((isset($_ENV) && \is_array($_ENV) && \count($_ENV)) ||
			(isset($_SERVER) && \is_array($_SERVER) && \count($_SERVER)))
		{
			$sEnvNames = $this->Get('labs', 'replace_env_in_configuration', '');
			if (\strlen($sEnvNames))
			{
				$this->aReplaceEnv = \explode(',', $sEnvNames);
				if (\is_array($this->aReplaceEnv))
				{
					$this->aReplaceEnv = \array_map('trim', $this->aReplaceEnv);
					$this->aReplaceEnv = \array_map('strtolower', $this->aReplaceEnv);
				}
			}
		}

		if (!\is_array($this->aReplaceEnv) || 0 === \count($this->aReplaceEnv))
		{
			$this->aReplaceEnv = null;
		}

		return $bResult;
	}

	/**
	 * @param mixed $mDefault = null
	 *
	 * @return mixed
	 */
	public function Get(string $sSection, string $sName, $mDefault = null)
	{
		$mResult = parent::Get($sSection, $sName, $mDefault);
		if ($this->aReplaceEnv && \is_string($mResult))
		{
			$sKey = \strtolower($sSection.'.'.$sName);
			if (\in_array($sKey, $this->aReplaceEnv) && false !== strpos($mResult, '$'))
			{
				$mResult = \preg_replace_callback('/\$([^\s]+)/', function($aMatch) {

					if (!empty($aMatch[0]) && !empty($aMatch[1]))
					{
						if (!empty($_ENV[$aMatch[1]]))
						{
							return $_SERVER[$aMatch[1]];
						}

						if (!empty($_SERVER[$aMatch[1]]))
						{
							return $_SERVER[$aMatch[1]];
						}

						return $aMatch[0];
					}

					return '';

				}, $mResult);
			}
		}

		return $mResult;
	}

	public function SetPassword(string $sPassword) : void
	{
		$this->Set('security', 'admin_password', \password_hash($sPassword, PASSWORD_DEFAULT));
	}

	public function ValidatePassword(string $sPassword) : bool
	{
		$sConfigPassword = (string) $this->Get('security', 'admin_password', '');
		if (32 == \strlen($sPassword) && \md5(APP_SALT.$sPassword.APP_SALT) === $sConfigPassword) {
			$this->SetPassword($sPassword);
			return true;
		}
		return \strlen($sPassword) && \password_verify($sPassword, $sConfigPassword);
	}

	public function Save() : bool
	{
		$this->Set('version', 'current', APP_VERSION);
		$this->Set('version', 'saved', \gmdate('r'));

		return parent::Save();
	}

	protected function defaultValues() : array
	{
		$value = \ini_get('upload_max_filesize');
		$upload_max_filesize = \intval($value);
		switch (\strtoupper(\substr($value, -1))) {
			case 'G': $upload_max_filesize *= 1024;
			case 'M': $upload_max_filesize *= 1024;
			case 'K': $upload_max_filesize *= 1024;
		}
		$upload_max_filesize = $upload_max_filesize / 1024 / 1024;

		$sCipher = 'aes-256-cbc-hmac-sha1';
		$aCiphers = \SnappyMail\Crypt::listCiphers();
		if (!\in_array($sCipher, $aCiphers)) {
			$sCipher = $aCiphers[\array_rand($aCiphers)];
		}

		return array(

			'webmail' => array(

				'title'                       => array('SnappyMail Webmail', 'Text displayed as page title'),
				'loading_description'         => array('SnappyMail', 'Text displayed on startup'),
				'favicon_url'                 => array('', ''),

				'theme'                       => array('Default', 'Theme used by default'),
				'allow_themes'                => array(true, 'Allow theme selection on settings screen'),
				'allow_user_background'       => array(false),

				'language'                    => array('en', 'Language used by default'),
				'language_admin'              => array('en', 'Admin Panel interface language'),
				'allow_languages_on_settings' => array(true, 'Allow language selection on settings screen'),

				'allow_additional_accounts'   => array(true, ''),
				'allow_additional_identities' => array(true, ''),

				'messages_per_page'           => array(20, 'Number of messages displayed on page by default'),
				'message_read_delay'          => array(5, 'Mark message read after N seconds'),

				'attachment_size_limit'       => array(\min($upload_max_filesize, 25), 'File size limit (MB) for file upload on compose screen
0 for unlimited.')
			),

			'interface' => array(
				'show_attachment_thumbnail' => array(true, ''),
				'new_move_to_folder_button' => array(true)
			),

			'contacts' => array(
				'enable'            => array(false, 'Enable contacts'),
				'allow_sync'        => array(false),
				'sync_interval'     => array(20),
				'type'              => array('sqlite', ''),
				'pdo_dsn'           => array('host=127.0.0.1;port=3306;dbname=snappymail', ''),
				'pdo_user'          => array('root', ''),
				'pdo_password'      => array('', ''),
				'suggestions_limit' => array(30)
			),

			'security' => array(
				'csrf_protection'    => array(true,
				    'Enable CSRF protection (http://en.wikipedia.org/wiki/Cross-site_request_forgery)'),

				'custom_server_signature'    => array('SnappyMail'),
				'x_frame_options_header'     => array('DENY'),
				'x_xss_protection_header'    => array('1; mode=block'),

				'openpgp'                    => array(false),

				'admin_login'                => array('admin', 'Login and password for web admin panel'),
				'admin_password'             => array(''),
				'admin_totp'                 => array(''),
				'allow_admin_panel'          => array(true, 'Access settings'),
				'hide_x_mailer_header'       => array(true),
				'admin_panel_host'           => array(''),
				'admin_panel_key'            => array('admin'),
				'content_security_policy'    => array(''),
				'encrypt_cipher'             => array($sCipher)
			),

			'ssl' => array(
				'verify_certificate' => array(false, 'Require verification of SSL certificate used.'),
				'allow_self_signed'  => array(true, 'Allow self-signed certificates. Requires verify_certificate.'),
				'cafile'             => array('', 'Location of Certificate Authority file on local filesystem (/etc/ssl/certs/ca-certificates.crt)'),
				'capath'             => array('', 'capath must be a correctly hashed certificate directory. (/etc/ssl/certs/)'),
				'client_cert'        => array('', 'Location of client certificate file (pem format with private key) on local filesystem'),
			),

			'capa' => array(
				'contacts' => array(true),
				'quota' => array(true),
				'search' => array(true),
				'search_adv' => array(true),
				'dangerous_actions' => array(true),
				'message_actions' => array(true),
				'attachments_actions' => array(true)
			),

			'login' => array(

				'default_domain' => array('', ''),

				'allow_languages_on_login' => array(true,
					'Allow language selection on webmail login screen'),

				'determine_user_language' => array(true, ''),
				'determine_user_domain' => array(false, ''),

				'hide_submit_button' => array(true),

				'login_lowercase' => array(true, ''),

				'sign_me_auto' => array(\RainLoop\Enumerations\SignMeType::DEFAULT_OFF,
					'This option allows webmail to remember the logged in user
once they closed the browser window.

Values:
  "DefaultOff" - can be used, disabled by default;
  "DefaultOn"  - can be used, enabled by default;
  "Unused"     - cannot be used')
			),

			'plugins' => array(
				'enable'       => array(false, 'Enable plugin support'),
				'enabled_list' => array('', 'List of enabled plugins'),
			),

			'defaults' => array(
				'view_editor_type'       => array('Html', 'Editor mode used by default (Plain, Html, HtmlForced or PlainForced)'),
				'view_layout'            => array(1, 'layout: 0 - no preview, 1 - side preview, 2 - bottom preview'),
				'view_use_checkboxes'    => array(true),
				'autologout'             => array(30),
				'show_images'            => array(false),
				'contacts_autosave'      => array(true),
				'mail_use_threads'       => array(false),
				'allow_draft_autosave'   => array(true),
				'mail_reply_same_folder' => array(false)
			),

			'logs' => array(

				'enable' => array(false, 'Enable logging'),

				'write_on_error_only' => array(false, 'Logs entire request only if error occured (php requred)'),
				'write_on_php_error_only' => array(false, 'Logs entire request only if php error occured'),
				'write_on_timeout_only' => array(0, 'Logs entire request only if request timeout (in seconds) occured.'),

				'hide_passwords' => array(true, 'Required for development purposes only.
Disabling this option is not recommended.'),

				'time_zone' => array('UTC'),
				'session_filter' => array(''),

				'filename' => array('log-{date:Y-m-d}.txt',
					'Log filename.
For security reasons, some characters are removed from filename.
Allows for pattern-based folder creation (see examples below).

Patterns:
  {date:Y-m-d}  - Replaced by pattern-based date
                  Detailed info: http://www.php.net/manual/en/function.date.php
  {user:email}  - Replaced by user\'s email address
                  If user is not logged in, value is set to "unknown"
  {user:login}  - Replaced by user\'s login (the user part of an email)
                  If user is not logged in, value is set to "unknown"
  {user:domain} - Replaced by user\'s domain name (the domain part of an email)
                  If user is not logged in, value is set to "unknown"
  {user:uid}    - Replaced by user\'s UID regardless of account currently used

  {user:ip}
  {request:ip}  - Replaced by user\'s IP address

Others:
  {imap:login} {imap:host} {imap:port}
  {smtp:login} {smtp:host} {smtp:port}

Examples:
  filename = "log-{date:Y-m-d}.txt"
  filename = "{date:Y-m-d}/{user:domain}/{user:email}_{user:uid}.log"
  filename = "{user:email}-{date:Y-m-d}.txt"
  filename = "syslog"'),

				'auth_logging' => array(false, 'Enable auth logging in a separate file (for fail2ban)'),
				'auth_logging_filename' => array('fail2ban/auth-{date:Y-m-d}.txt'),
				'auth_logging_format' => array('[{date:Y-m-d H:i:s}] Auth failed: ip={request:ip} user={imap:login} host={imap:host} port={imap:port}')
			),

			'debug' => array(
				'enable' => array(false, 'Special option required for development purposes')
			),

			'cache' => array(
				'enable' => array(true,
					'The section controls caching of the entire application.

Enables caching in the system'),

				'index' => array('v1', 'Additional caching key. If changed, cache is purged'),

				'fast_cache_driver' => array('files', 'Can be: files, APCU, memcache, redis (beta)'),
				'fast_cache_index' => array('v1', 'Additional caching key. If changed, fast cache is purged'),

				'http' => array(true, 'Browser-level cache. If enabled, caching is maintainted without using files'),
				'http_expires' => array(3600, 'Browser-level cache time (seconds, Expires header)'),

				'server_uids' => array(true, 'Caching message UIDs when searching and sorting (threading)')
			),

			'labs' => array(
				'allow_prefetch' => array(false),
				'cache_system_data' => array(true),
				'date_from_headers' => array(true),
				'autocreate_system_folders' => array(false),
				'allow_message_append' => array(false),
				'login_fault_delay' => array(1),
				'log_ajax_response_write_limit' => array(300),
				'allow_html_editor_biti_buttons' => array(false),
				'allow_ctrl_enter_on_compose' => array(true),
				'try_to_detect_hidden_images' => array(false),
				'use_app_debug_js' => array(false),
				'use_mobile_version_for_tablets' => array(false),
				'use_app_debug_css' => array(false),
				'use_imap_sort' => array(true),
				'use_imap_force_selection' => array(false),
				'use_imap_list_subscribe' => array(true),
				'use_imap_thread' => array(true),
				'use_imap_move' => array(false),
				'use_imap_expunge_all_on_delete' => array(false),
				'imap_forwarded_flag' => array('$Forwarded'),
				'imap_read_receipt_flag' => array('$ReadReceipt'),
				'imap_body_text_limit' => array(555000),
				'imap_message_list_fast_simple_search' => array(true),
				'imap_message_list_count_limit_trigger' => array(0),
				'imap_message_list_date_filter' => array(0),
				'imap_message_list_permanent_filter' => array(''),
				'imap_message_all_headers' => array(false),
				'imap_large_thread_limit' => array(50),
				'imap_folder_list_limit' => array(200),
				'imap_show_login_alert' => array(true),
				'imap_use_auth_plain' => array(true),
				'imap_use_auth_cram_md5' => array(false),
				'imap_use_list_status' => array(true),
				'smtp_show_server_errors' => array(false),
				'smtp_use_auth_plain' => array(true),
				'smtp_use_auth_cram_md5' => array(false),
				'sieve_auth_plain_initial' => array(true),
				'sieve_allow_fileinto_inbox' => array(false),
				'imap_timeout' => array(300),
				'smtp_timeout' => array(60),
				'sieve_timeout' => array(10),
				'domain_list_limit' => array(99),
				'mail_func_clear_headers' => array(true),
				'mail_func_additional_parameters' => array(false),
				'favicon_status' => array(true),
				'folders_spec_limit' => array(50),
				'curl_proxy' => array(''),
				'curl_proxy_auth' => array(''),
				'in_iframe' => array(false),
				'force_https' => array(false),
				'http_client_ip_check_proxy' => array(false),
				'fast_cache_memcache_host' => array('127.0.0.1'),
				'fast_cache_memcache_port' => array(11211),
				'fast_cache_redis_host' => array('127.0.0.1'),
				'fast_cache_redis_port' => array(6379),
				'use_local_proxy_for_external_images' => array(true),
				'detect_image_exif_orientation' => array(true),
				'cookie_default_path' => array(''),
				'cookie_default_secure' => array(false),
				'check_new_messages' => array(true),
				'replace_env_in_configuration' => array(''),
				'strict_html_parser' => array(false),
				'boundary_prefix' => array(''),
				'kolab_enabled' => array(false),
				'dev_email' => array(''),
				'dev_password' => array('')
			),

			'version' => array(
				'current' => array(''),
				'saved' => array('')
			)
		);
	}
}
