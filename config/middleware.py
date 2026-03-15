from django.utils.deprecation import MiddlewareMixin


class ApiCsrfExemptMiddleware(MiddlewareMixin):
    """
    Mark views under /api/ as CSRF-exempt so the SPA can call them without
    sending a CSRF token. The API uses map UUID for authorization, not session.
    """

    def process_view(self, request, view_func, view_args, view_kwargs):
        if request.path.startswith("/api/"):
            view_func.csrf_exempt = True
        return None
