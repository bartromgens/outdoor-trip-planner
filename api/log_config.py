import logging

_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"

_TIME_COLOR = "\033[90m"
_NAME_COLOR = "\033[35m"

_LEVEL_COLORS: dict[str, str] = {
    "DEBUG": "\033[36m",
    "INFO": "\033[32m",
    "WARNING": "\033[33m",
    "ERROR": "\033[31m",
    "CRITICAL": "\033[1;31m",
}

_LEVEL_ICONS: dict[str, str] = {
    "DEBUG": "·",
    "INFO": "●",
    "WARNING": "▲",
    "ERROR": "✖",
    "CRITICAL": "✖✖",
}

_SHORT_PREFIX = "api.services."


def _shorten_name(name: str) -> str:
    if name.startswith(_SHORT_PREFIX):
        return name[len(_SHORT_PREFIX) :]
    if name.startswith("api."):
        return name[4:]
    return name


class ColoredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        level = record.levelname
        level_color = _LEVEL_COLORS.get(level, "")
        icon = _LEVEL_ICONS.get(level, "·")

        time_str = self.formatTime(record, "%H:%M:%S")
        name = _shorten_name(record.name)

        prefix = (
            f"{_TIME_COLOR}{time_str}{_RESET} "
            f"{level_color}{icon} {_BOLD}{level:<8}{_RESET} "
            f"{_DIM}{_NAME_COLOR}{name:<24}{_RESET}  "
        )

        msg = record.getMessage()

        if record.exc_info:
            msg += "\n" + self.formatException(record.exc_info)

        return prefix + msg
